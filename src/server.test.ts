import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { tmpdir } from "node:os";

import { loadConfig } from "./config.ts";
import { sqliteReviewStore } from "./state.ts";
import { connectedClient, fakePreflight } from "./testing.ts";

type Structured<T> = { structuredContent?: T; isError?: boolean; content: { type: string; text?: string }[] };
type Client = Awaited<ReturnType<typeof connectedClient>>["client"];
const call = async <T = Record<string, unknown>>(client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as unknown as Structured<T>;

const upstreams: ReturnType<typeof fakePreflight>[] = [];
const upstream = (options?: Parameters<typeof fakePreflight>[0]) => {
  const fake = fakePreflight(options);
  upstreams.push(fake);
  return fake;
};
afterEach(() => upstreams.splice(0).forEach((fake) => fake.stop()));

describe("Preflight MCP server", () => {
  it("links UI tools to ui:// views and hides human-only tools from the model", async () => {
    const { client } = await connectedClient();
    const byName = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]));
    expect([...byName.keys()].sort()).toEqual(["preflight_readiness", "preflight_release_approve", "preflight_release_execute", "preflight_release_reset", "preflight_release_review"]);
    expect(byName.get("preflight_readiness")?._meta).toMatchObject({ ui: { resourceUri: "ui://preflight/readiness.html", visibility: ["model", "app"] } });
    expect(byName.get("preflight_release_review")?._meta).toMatchObject({ ui: { resourceUri: "ui://preflight/release-review.html", visibility: ["model", "app"] } });
    expect(byName.get("preflight_release_execute")?._meta).toMatchObject({ ui: { visibility: ["model", "app"] } });
    expect(byName.get("preflight_release_approve")?._meta).toEqual({ ui: { visibility: ["app"] } });
    expect(byName.get("preflight_release_reset")?._meta).toEqual({ ui: { visibility: ["app"] } });
    expect(byName.get("preflight_readiness")?.annotations?.readOnlyHint).toBe(true);
  });

  it("serves each view as a self-contained MCP App resource", async () => {
    const { client } = await connectedClient();
    const { resources } = await client.listResources();
    expect(resources.map((resource) => [resource.uri, resource.mimeType])).toEqual([
      ["ui://preflight/readiness.html", RESOURCE_MIME_TYPE],
      ["ui://preflight/release-review.html", RESOURCE_MIME_TYPE],
    ]);
    for (const resource of resources) {
      const html = ((await client.readResource({ uri: resource.uri })).contents[0] as { text: string }).text;
      expect(html).toStartWith("<!doctype html>");
      expect(html).toContain("ui/initialize");
      // T3's sandbox CSP is default-src 'none': nothing may load from outside.
      expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
      expect(html.length).toBeLessThan(100_000);
    }
  });

  it("reads app readiness and release checks from Preflight", async () => {
    const fake = upstream({ release: { passing: 3, total: 4 } });
    const { client } = await connectedClient({ endpoint: fake.url });
    const result = await call<{ platform: string; ready: boolean; snapshot: { apps: { name: string }[] }; pollSeconds: number }>(client, "preflight_readiness", { platform: "android" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ platform: "android", ready: false, pollSeconds: 30 });
    expect(result.structuredContent?.snapshot.apps.map((app) => app.name)).toEqual(["T3 <Mobile>", "t3-desktop"]);
    expect(result.content[0]?.text).toContain("android release checks: 3/4 passing");
    expect(result.content[0]?.text).toContain("app-2 [building] t3-desktop");
    expect(fake.requests).toEqual(["GET /api/preflight/v1/apps", "GET /api/preflight/v1/release-status?platform=android"]);
  });

  it("reports missing configuration instead of returning data", async () => {
    const problem = loadConfig({ PREFLIGHT_ENDPOINT: "https://preflight.example" }).problem;
    expect(problem).toContain("PREFLIGHT_TOKEN");
    const { client } = await connectedClient({ token: null, ...(problem ? { problem } : {}) });
    for (const name of ["preflight_readiness", "preflight_release_review", "preflight_release_execute"]) {
      const result = await call(client, name);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(name === "preflight_release_execute" ? "Preflight is not configured" : "PREFLIGHT_TOKEN");
    }
  });

  it("keeps upstream failures short and free of URLs and bodies", async () => {
    const fake = upstream({ failWith: 503 });
    const { client } = await connectedClient({ endpoint: fake.url });
    const result = await call(client, "preflight_readiness");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Preflight is temporarily unavailable (503)");

    const rejected = await call((await connectedClient({ endpoint: fake.url, token: "wrong" })).client, "preflight_readiness");
    expect(rejected.content[0]?.text).toBe("Preflight rejected the token (401). Check PREFLIGHT_TOKEN.");
  });

  it("reports an unreachable Preflight as a tool error", async () => {
    const fake = upstream();
    const endpoint = fake.url;
    fake.stop();
    const result = await call((await connectedClient({ endpoint })).client, "preflight_readiness");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/^Preflight (could not be reached|did not respond within 2s)$/);
  });

  it("requires human approval before executing a release, then allows a new review", async () => {
    const fake = upstream();
    const { client } = await connectedClient({ endpoint: fake.url });
    const review = await call<{ workflow: { currentStage: string; actions: { id: string }[] } }>(client, "preflight_release_review");
    expect(review.structuredContent?.workflow).toMatchObject({ currentStage: "approve", actions: [{ id: "approve" }] });

    const early = await call(client, "preflight_release_execute");
    expect(early.isError).toBe(true);
    expect(early.content[0]?.text).toContain("must be approved");
    expect(fake.releases).toEqual([]);

    expect((await call(client, "preflight_release_approve")).isError).toBeFalsy();
    // Approval is per platform.
    expect((await call(client, "preflight_release_execute", { platform: "android" })).isError).toBe(true);

    const done = await call<{ workflow: { currentStage: string }; release: { releaseId: string }; state: { releaseId: string } }>(client, "preflight_release_execute");
    expect(done.isError).toBeFalsy();
    expect(done.content[0]?.text).toBe("Preflight queued release rel-1 for ios.");
    expect(done.structuredContent).toMatchObject({ workflow: { currentStage: "verify" }, release: { releaseId: "rel-1" }, state: { releaseId: "rel-1" } });
    expect(fake.releases).toEqual([{ platform: "ios" }]);

    // No double release, and no re-approval until a new review starts.
    expect((await call(client, "preflight_release_execute")).isError).toBe(true);
    expect((await call(client, "preflight_release_approve")).isError).toBe(true);
    await call(client, "preflight_release_reset");
    const fresh = await call<{ workflow: { currentStage: string } }>(client, "preflight_release_review");
    expect(fresh.structuredContent?.workflow.currentStage).toBe("approve");
    expect(fake.releases).toHaveLength(1);
  });

  it("does not record an execution Preflight rejected", async () => {
    const healthy = upstream();
    const failing = upstream({ failWith: 500 });
    const state = (await import("./state.ts")).memoryReviewStore();
    await call((await connectedClient({ endpoint: healthy.url, state })).client, "preflight_release_approve");
    const result = await call((await connectedClient({ endpoint: failing.url, state })).client, "preflight_release_execute");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Preflight is temporarily unavailable (500)");
    expect(await state.get("ios")).toMatchObject({ approved: true, executionRequested: false });
  });

  it("reports a queued release as success when the follow-up status read fails", async () => {
    const fake = upstream({ failStatusAfterRelease: 503 });
    const state = (await import("./state.ts")).memoryReviewStore();
    const { client } = await connectedClient({ endpoint: fake.url, state });
    await call(client, "preflight_release_approve");
    const done = await call<{ platform: string; release: { releaseId: string }; state: { executionRequested: boolean; releaseId: string }; refreshError: string; workflow?: unknown }>(
      client,
      "preflight_release_execute",
    );
    expect(done.isError).toBeFalsy();
    expect(done.content[0]?.text).toStartWith("Preflight queued release rel-1 for ios.");
    expect(done.content[0]?.text).toContain("could not be refreshed (Preflight is temporarily unavailable (503))");
    expect(done.content[0]?.text).not.toContain(fake.url);
    expect(done.structuredContent).toMatchObject({ platform: "ios", release: { releaseId: "rel-1" }, state: { executionRequested: true, releaseId: "rel-1" }, refreshError: "Preflight is temporarily unavailable (503)" });
    expect(done.structuredContent?.workflow).toBeUndefined();
    expect(await state.get("ios")).toMatchObject({ approved: true, executionRequested: true, releaseId: "rel-1" });
    expect(fake.requests).toContain("GET /api/preflight/v1/release-status?platform=ios");
    expect(fake.releases).toEqual([{ platform: "ios" }]);
  });

  it("shares approval between plugin copies through the state file", async () => {
    // T3 runs one stdio copy per agent session plus one in its pool: a panel
    // approves in one process and the agent executes from another.
    const fake = upstream();
    const path = `${tmpdir()}/preflight-state-${crypto.randomUUID()}.sqlite`;
    const pool = await connectedClient({ endpoint: fake.url, state: sqliteReviewStore(new Database(path, { create: true })) });
    const session = await connectedClient({ endpoint: fake.url, state: sqliteReviewStore(new Database(path, { create: true })) });
    await call(pool.client, "preflight_release_approve");
    expect((await call(session.client, "preflight_release_execute")).isError).toBeFalsy();
    expect(fake.releases).toEqual([{ platform: "ios" }]);
  });
});

describe("config", () => {
  it("defaults the endpoint and clamps the refresh interval", () => {
    const config = loadConfig({ PREFLIGHT_TOKEN: " t ", PREFLIGHT_POLL_SECONDS: "5", XDG_STATE_HOME: "/state" });
    expect(config).toEqual({ endpoint: "https://preflight.forgegraf.com", token: "t", pollSeconds: 15, statePath: "/state/t3code-preflight-plugin/state.sqlite" });
    expect(loadConfig({ PREFLIGHT_TOKEN: "t", PREFLIGHT_POLL_SECONDS: "nope" }).pollSeconds).toBe(60);
    expect(loadConfig({ PREFLIGHT_TOKEN: "t", PREFLIGHT_ENDPOINT: "preflight.forgegraf.com" }).problem).toContain("PREFLIGHT_ENDPOINT");
  });
});
