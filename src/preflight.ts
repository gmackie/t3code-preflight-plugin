type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type PreflightSnapshot = { apps: readonly { id: string; name: string; status: string }[]; release: { passing: number; total: number } };
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
