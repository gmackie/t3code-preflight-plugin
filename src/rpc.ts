import { buildReviewWorkflow, buildSurfaceModel, type PreflightSnapshot } from "./preflight.ts";

export function createRpcHandler(coordinator: {
  snapshot: PreflightSnapshot | null;
  refresh(): Promise<PreflightSnapshot>;
  workflowState?: { approved: boolean; executionRequested?: boolean };
  saveWorkflowState?: () => Promise<void>;
  executeRelease?: (input: { platform?: string }) => Promise<{ releaseId?: string }>;
}) {
  const workflowState = coordinator.workflowState ?? { approved: false };
  return async (method: string, payload?: { navigationId?: string; panelId?: string; actionId?: string; workflowId?: string; input?: unknown }) => {
    if (method === "workflow.get") return { ok: true as const, result: buildReviewWorkflow(coordinator.snapshot ?? (await coordinator.refresh()), workflowState) };
    if (method === "action.execute" && payload?.actionId === "approve") {
      workflowState.approved = true;
      await coordinator.saveWorkflowState?.();
      return { ok: true as const, result: { status: "accepted" as const, message: "Release action approved." } };
    }
    if (method === "action.execute" && payload?.actionId === "execute") {
      if (!workflowState.approved) return { ok: false as const, error: "Release workflow must be approved before execution." };
      const input = payload.input && typeof payload.input === "object" ? payload.input as Record<string, unknown> : {};
      const result = await coordinator.executeRelease?.({ platform: typeof input.platform === "string" ? input.platform : undefined });
      workflowState.executionRequested = true;
      await coordinator.saveWorkflowState?.();
      return { ok: true as const, result: { status: "accepted" as const, message: result?.releaseId ? `Release ${result.releaseId} queued.` : "Release pipeline queued." } };
    }
    if (method !== "surface.get") return { ok: false as const, error: `unsupported Preflight RPC method: ${method}` };
    const snapshot = coordinator.snapshot ?? (await coordinator.refresh());
    return { ok: true as const, result: buildSurfaceModel(snapshot, payload?.navigationId) };
  };
}
