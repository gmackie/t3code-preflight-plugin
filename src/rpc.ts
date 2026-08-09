import { buildReviewWorkflow, buildSurfaceModel, type PreflightSnapshot } from "./preflight.ts";

export function createRpcHandler(coordinator: {
  snapshot: PreflightSnapshot | null;
  refresh(): Promise<PreflightSnapshot>;
}) {
  return async (method: string, payload?: { navigationId?: string; panelId?: string; actionId?: string; workflowId?: string }) => {
    if (method === "workflow.get") return { ok: true as const, result: buildReviewWorkflow(coordinator.snapshot ?? (await coordinator.refresh())) };
    if (method !== "surface.get") return { ok: false as const, error: `unsupported Preflight RPC method: ${method}` };
    const snapshot = coordinator.snapshot ?? (await coordinator.refresh());
    return { ok: true as const, result: buildSurfaceModel(snapshot, payload?.navigationId) };
  };
}
