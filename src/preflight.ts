type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type PreflightSnapshot = { apps: readonly { id: string; name: string; status: string }[]; release: { passing: number; total: number } };
export type ReviewWorkflowModel = { readonly pluginId: string; readonly workflowId: string; readonly title: string; readonly currentStage: "inspect" | "context" | "propose" | "review" | "approve" | "execute" | "verify" | "respond"; readonly refreshedAt: string; readonly steps: readonly { id: string; stage: ReviewWorkflowModel["currentStage"]; title: string; state: "pending" | "active" | "completed" | "blocked" | "failed"; detail?: string }[]; readonly actions?: readonly { id: string; title: string; tone?: "primary" | "secondary" | "destructive" }[] };
export function buildReviewWorkflow(snapshot: PreflightSnapshot): ReviewWorkflowModel {
  const releaseReady = snapshot.release.total > 0 && snapshot.release.passing === snapshot.release.total;
  const steps = [
    { id: "inspect", stage: "inspect" as const, title: "Inspect app state", state: "completed" as const },
    { id: "context", stage: "context" as const, title: "Build release context", state: "completed" as const, detail: `${snapshot.apps.length} apps registered` },
    { id: "propose", stage: "propose" as const, title: "Propose release response", state: "completed" as const },
    { id: "review", stage: "review" as const, title: "Review release plan", state: "completed" as const },
    { id: "approve", stage: "approve" as const, title: "Approve release", state: "pending" as const },
    { id: "execute", stage: "execute" as const, title: "Execute release pipeline", state: "pending" as const },
    { id: "verify", stage: "verify" as const, title: "Verify release checks", state: releaseReady ? "completed" as const : "active" as const, detail: `${snapshot.release.passing}/${snapshot.release.total} checks passing` },
    { id: "respond", stage: "respond" as const, title: "Prepare release response", state: "pending" as const },
  ];
  return { pluginId: "com.t3code.preflight", workflowId: "preflight.release-review", title: "Release review", currentStage: releaseReady ? "approve" : "verify", refreshedAt: new Date().toISOString(), steps, actions: [{ id: "approve", title: "Approve release action", tone: "primary" }] };
}
export type CockpitViewModel = { navigation: readonly string[]; metrics: { apps: number; releasePassing: number; releaseTotal: number } };
export type SurfaceCard =
  | { kind: "metric"; id: string; title: string; value: string; detail?: string; status?: "neutral" | "positive" | "warning" | "negative" }
  | { kind: "list"; id: string; title: string; items: readonly { id: string; title: string; detail?: string; status?: "neutral" | "positive" | "warning" | "negative" }[] };
export type SurfaceModel = { pluginId: string; navigationId: string; title: string; refreshedAt: string; cards: readonly SurfaceCard[] };

async function get(input: { endpoint: string; token: string; fetchImpl: FetchLike }, path: string): Promise<any> {
  const response = await input.fetchImpl(`${input.endpoint.replace(/\/$/, "")}${path}`, { headers: { authorization: `Bearer ${input.token}` } });
  if (!response.ok) throw new Error(`Preflight GET ${path} failed: ${response.status}`);
  return response.json();
}

export function normalizePreflightSnapshot(value: any): PreflightSnapshot {
  return { apps: Array.isArray(value?.apps) ? value.apps.map((app: any) => ({ id: String(app.id), name: String(app.name ?? app.slug ?? app.id), status: String(app.status ?? "unknown") })) : [], release: { passing: Number(value?.releaseStatus?.passing ?? 0), total: Number(value?.releaseStatus?.total ?? 0) } };
}
export function buildCockpitViewModel(snapshot: PreflightSnapshot): CockpitViewModel { return { navigation: ["apps", "cockpit", "builds", "proof", "releases", "runners"], metrics: { apps: snapshot.apps.length, releasePassing: snapshot.release.passing, releaseTotal: snapshot.release.total } }; }
export function buildSurfaceModel(snapshot: PreflightSnapshot, navigationId = "preflight.cockpit"): SurfaceModel {
  return {
    pluginId: "com.t3code.preflight",
    navigationId,
    title: "Release readiness",
    refreshedAt: new Date().toISOString(),
    cards: [
      { kind: "metric", id: "apps", title: "Apps", value: `${snapshot.apps.length}` },
      { kind: "metric", id: "release-health", title: "Release checks", value: `${snapshot.release.passing}/${snapshot.release.total}`, status: snapshot.release.total > 0 && snapshot.release.passing === snapshot.release.total ? "positive" : "warning" },
      { kind: "list", id: "apps-list", title: "Registered apps", items: snapshot.apps.map((app) => ({ id: app.id, title: app.name, detail: app.status, status: app.status === "ready" ? "positive" as const : "warning" as const })) },
    ],
  };
}

export function createPreflightClient(input: { endpoint: string; token: string; fetchImpl?: FetchLike }) {
  const transport = { ...input, fetchImpl: input.fetchImpl ?? fetch };
  return { async snapshot() { const apps = await get(transport, "/api/preflight/v1/apps"); const releaseStatus = await get(transport, "/api/preflight/v1/release-status?platform=ios"); return normalizePreflightSnapshot({ apps: apps.apps ?? apps.data?.apps ?? apps, releaseStatus: releaseStatus.releaseStatus ?? releaseStatus.data?.releaseStatus ?? releaseStatus }); } };
}

export function normalizePollingSeconds(value: number | undefined): number { return Math.min(3600, Math.max(15, Math.floor(value ?? 60))); }
export function createPollingCoordinator<T>(input: { refresh: () => Promise<T>; intervalSeconds?: number; onError?: (error: unknown) => void }) { let cached: T | null = null; let timer: ReturnType<typeof setTimeout> | undefined; let active = false; const interval = normalizePollingSeconds(input.intervalSeconds) * 1000; const tick = async () => { if (!active) return; try { cached = await input.refresh(); } catch (error) { input.onError?.(error); } finally { if (active) timer = setTimeout(tick, interval); } }; return { get snapshot() { return cached; }, async refresh() { cached = await input.refresh(); return cached; }, start() { active = true; void tick(); }, stop() { active = false; if (timer) clearTimeout(timer); } }; }
