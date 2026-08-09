import { buildSurfaceModel, type PreflightSnapshot } from "./preflight.ts";

export function createRpcHandler(coordinator: {
  snapshot: PreflightSnapshot | null;
  refresh(): Promise<PreflightSnapshot>;
}) {
  return async (method: string, payload?: { navigationId?: string }) => {
    if (method !== "surface.get") return { ok: false as const, error: `unsupported Preflight RPC method: ${method}` };
    const snapshot = coordinator.snapshot ?? (await coordinator.refresh());
    return { ok: true as const, result: buildSurfaceModel(snapshot, payload?.navigationId) };
  };
}
