import { describe, expect, test } from "bun:test";
import { createRpcHandler } from "./rpc.ts";

describe("Preflight RPC", () => {
  test("serves app readiness as native surface cards", async () => {
    const handler = createRpcHandler({ snapshot: { apps: [], release: { passing: 1, total: 1 } }, refresh: async () => ({ apps: [], release: { passing: 0, total: 0 } }) });
    await expect(handler("surface.get", { navigationId: "preflight.releases" })).resolves.toMatchObject({ ok: true, result: { pluginId: "com.t3code.preflight", navigationId: "preflight.releases" } });
  });

  test("serves the canonical release review workflow", async () => {
    const handler = createRpcHandler({ snapshot: { apps: [], release: { passing: 3, total: 4 } }, refresh: async () => ({ apps: [], release: { passing: 0, total: 0 } }) });
    await expect(handler("workflow.get", { workflowId: "preflight.release-review" })).resolves.toMatchObject({ ok: true, result: { workflowId: "preflight.release-review", currentStage: "verify" } });
  });

  test("persists approval actions in the workflow coordinator", async () => {
    let saved = false;
    const handler = createRpcHandler({ snapshot: { apps: [], release: { passing: 1, total: 1 } }, refresh: async () => ({ apps: [], release: { passing: 0, total: 0 } }), workflowState: { approved: false }, saveWorkflowState: async () => { saved = true; } });
    await expect(handler("action.execute", { actionId: "approve", input: { workflowId: "preflight.release-review" } })).resolves.toMatchObject({ ok: true, result: { status: "accepted" } });
    expect(saved).toBe(true);
    await expect(handler("workflow.get", { workflowId: "preflight.release-review" })).resolves.toMatchObject({ result: { currentStage: "execute" } });
  });

  test("executes an approved release through the plugin callback", async () => {
    let executed = false;
    let saved = false;
    const handler = createRpcHandler({
      snapshot: { apps: [], release: { passing: 1, total: 1 } },
      refresh: async () => ({ apps: [], release: { passing: 1, total: 1 } }),
      workflowState: { approved: true, executionRequested: false },
      saveWorkflowState: async () => { saved = true; },
      executeRelease: async (input) => { executed = input.platform === "ios"; return { releaseId: "release-1" }; },
    });
    await expect(handler("action.execute", { actionId: "execute", input: { workflowId: "preflight.release-review", platform: "ios" } })).resolves.toMatchObject({ ok: true, result: { status: "accepted" } });
    expect(executed).toBe(true);
    expect(saved).toBe(true);
    await expect(handler("workflow.get", { workflowId: "preflight.release-review" })).resolves.toMatchObject({ result: { currentStage: "verify" } });
  });
});
