import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { buildCockpitViewModel, buildReviewWorkflow, buildSurfaceModel, isReleaseReady, type PreflightClient } from "./preflight.ts";
import type { ReleaseReviewStore } from "./state.ts";
import { VIEWS, viewHtml, type ViewName } from "./views/html.ts";
import type { ReadinessData, ReviewData } from "./views/render.ts";

export const SERVER_INFO = { name: "preflight", version: "0.3.0" } as const;
export const DEFAULT_PLATFORM = "ios";

export type PreflightServerOptions = {
  /** Undefined when the plugin is not configured; `problem` then says what to set. */
  client: PreflightClient | undefined;
  problem?: string;
  state: ReleaseReviewStore;
  pollSeconds: number;
};

const platform = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/u, "platform is a short lowercase id such as ios or android")
  .optional()
  .describe(`Release platform, e.g. ios or android; defaults to ${DEFAULT_PLATFORM}`);

export function createPreflightMcpServer(options: PreflightServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Preflight tracks app builds, validation and release readiness. Use preflight_readiness for registered apps and release checks, and preflight_release_review before a release. Executing a release requires a human to approve it in the release review view.",
  });

  const client = () => {
    if (!options.client) throw new Error(options.problem ?? "Preflight is not configured: set PREFLIGHT_TOKEN in the Preflight plugin settings.");
    return options.client;
  };

  async function review(name: string): Promise<ReviewData> {
    const [snapshot, state] = await Promise.all([client().snapshot(name), options.state.get(name)]);
    return { platform: name, snapshot, state, workflow: buildReviewWorkflow(snapshot, state), pollSeconds: options.pollSeconds };
  }

  for (const [name, view] of Object.entries(VIEWS) as [ViewName, (typeof VIEWS)[ViewName]][]) {
    registerAppResource(server, view.title, view.uri, { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { prefersBorder: true } } }, async () => ({
      contents: [{ uri: view.uri, mimeType: RESOURCE_MIME_TYPE, text: await viewHtml(name), _meta: { ui: { prefersBorder: true } } }],
    }));
  }

  registerAppTool(
    server,
    "preflight_readiness",
    {
      title: "Preflight readiness",
      description: "List the apps registered in Preflight with their readiness, and the release checks for a platform. Renders the Preflight readiness view.",
      inputSchema: z.object({ platform }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.readiness.uri, visibility: ["model", "app"] } },
    },
    async ({ platform: name = DEFAULT_PLATFORM }) =>
      result(async () => {
        const snapshot = await client().snapshot(name);
        const surface = buildSurfaceModel(snapshot, "preflight.cockpit");
        const { metrics } = buildCockpitViewModel(snapshot);
        const data: ReadinessData = { platform: name, snapshot, surface, ready: isReleaseReady(snapshot), pollSeconds: options.pollSeconds, refreshedAt: surface.refreshedAt };
        const lines = snapshot.apps.map((app) => `- ${app.id} [${app.status}] ${app.name}`);
        return {
          data,
          text: `${metrics.apps} Preflight apps. ${name} release checks: ${metrics.releasePassing}/${metrics.releaseTotal} passing${data.ready ? " (ready)" : ""}.${lines.length ? `\n${lines.join("\n")}` : ""}`,
        };
      }),
  );

  registerAppTool(
    server,
    "preflight_release_review",
    {
      title: "Preflight release review",
      description: "Show the release review for a platform: stages, release check evidence and the next action. A human approves the release in the rendered view.",
      inputSchema: z.object({ platform }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.review.uri, visibility: ["model", "app"] } },
    },
    async ({ platform: name = DEFAULT_PLATFORM }) =>
      result(async () => {
        const data = await review(name);
        const next = data.workflow.actions?.[0]?.title ?? "none";
        return { data, text: `Release review (${name}): stage ${data.workflow.currentStage}, ${data.snapshot.release.passing}/${data.snapshot.release.total} checks passing, next action: ${next}.` };
      }),
  );

  // App-only: the agent cannot approve its own release; T3 hides this tool from
  // the model and only lets the view call it.
  server.registerTool(
    "preflight_release_approve",
    {
      title: "Approve Preflight release",
      description: "Record human approval to execute the release pipeline for a platform.",
      inputSchema: z.object({ platform }),
      annotations: { idempotentHint: true },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ platform: name = DEFAULT_PLATFORM }) =>
      result(async () => {
        const state = await options.state.get(name);
        if (state.executionRequested) throw new Error(`The ${name} release was already executed. Start a new review first.`);
        await options.state.save(name, { approved: true, executionRequested: false });
        return { data: { platform: name, approved: true }, text: `Preflight release approved for ${name}.` };
      }),
  );

  registerAppTool(
    server,
    "preflight_release_execute",
    {
      title: "Execute Preflight release",
      description: "Start the Preflight release pipeline for a platform. Fails unless a human approved the release in the release review.",
      inputSchema: z.object({ platform }),
      annotations: { openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.review.uri, visibility: ["model", "app"] } },
    },
    async ({ platform: name = DEFAULT_PLATFORM }) =>
      result(async () => {
        const preflight = client();
        const state = await options.state.get(name);
        if (!state.approved) throw new Error(`The ${name} release must be approved in the Preflight release review before execution.`);
        if (state.executionRequested) throw new Error(`The ${name} release was already executed${state.releaseId ? ` as ${state.releaseId}` : ""}. Start a new review to release again.`);
        const release = await preflight.startRelease({ platform: name });
        await options.state.save(name, { approved: true, executionRequested: true, ...(release.releaseId ? { releaseId: release.releaseId } : {}) });
        const data = { ...(await review(name)), release };
        return { data, text: release.releaseId ? `Preflight queued release ${release.releaseId} for ${name}.` : `Preflight accepted the ${name} release request.` };
      }),
  );

  // App-only reverse of approve/execute: clears the review so a human can
  // withdraw an approval or review the next release.
  server.registerTool(
    "preflight_release_reset",
    {
      title: "Start a new Preflight release review",
      description: "Withdraw the approval and clear the recorded execution for a platform.",
      inputSchema: z.object({ platform }),
      annotations: { idempotentHint: true },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ platform: name = DEFAULT_PLATFORM }) =>
      result(async () => {
        await options.state.clear(name);
        return { data: { platform: name, approved: false, executionRequested: false }, text: `Preflight release review reset for ${name}.` };
      }),
  );

  return server;
}

async function result(run: () => Promise<{ data: unknown; text: string }>): Promise<CallToolResult> {
  try {
    const { data, text } = await run();
    return { content: [{ type: "text", text }], structuredContent: data as Record<string, unknown> };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}
