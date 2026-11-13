// Preflight domain module: the REST client for the stable /api/preflight/v1
// endpoints and the pure view models the MCP tools and ui:// views share.
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type PreflightApp = { id: string; name: string; status: string };
export type PreflightSnapshot = { apps: readonly PreflightApp[]; release: { passing: number; total: number } };
export type ReviewStage = "inspect" | "context" | "propose" | "review" | "approve" | "execute" | "verify" | "respond";
export type ReviewWorkflowModel = {
  readonly pluginId: string;
  readonly workflowId: string;
  readonly title: string;
  readonly currentStage: ReviewStage;
  readonly refreshedAt: string;
  readonly steps: readonly { id: string; stage: ReviewStage; title: string; state: "pending" | "active" | "completed" | "blocked" | "failed"; detail?: string }[];
  readonly evidence?: readonly { id: string; title: string; kind: "check" | "artifact" | "diff" | "log" | "link"; status: "neutral" | "positive" | "warning" | "negative"; detail?: string; url?: string }[];
  readonly actions?: readonly { id: string; title: string; tone?: "primary" | "secondary" | "destructive" }[];
};
export type ReviewState = { readonly approved?: boolean; readonly executionRequested?: boolean };

export const PLUGIN_ID = "com.t3code.preflight";
export const REQUEST_TIMEOUT_MS = 15_000;

export function isReleaseReady(snapshot: PreflightSnapshot): boolean {
  return snapshot.release.total > 0 && snapshot.release.passing === snapshot.release.total;
}

export function buildReviewWorkflow(snapshot: PreflightSnapshot, state: ReviewState = {}): ReviewWorkflowModel {
  const releaseReady = isReleaseReady(snapshot);
  const checks = `${snapshot.release.passing}/${snapshot.release.total} checks passing`;
  const steps = [
    { id: "inspect", stage: "inspect" as const, title: "Inspect app state", state: "completed" as const },
    { id: "context", stage: "context" as const, title: "Build release context", state: "completed" as const, detail: `${snapshot.apps.length} apps registered` },
    { id: "propose", stage: "propose" as const, title: "Propose release response", state: "completed" as const },
    { id: "review", stage: "review" as const, title: "Review release plan", state: "completed" as const },
    { id: "approve", stage: "approve" as const, title: "Approve release", state: state.approved ? ("completed" as const) : ("pending" as const) },
    { id: "execute", stage: "execute" as const, title: "Execute release pipeline", state: state.executionRequested ? ("completed" as const) : state.approved ? ("active" as const) : ("pending" as const) },
    { id: "verify", stage: "verify" as const, title: "Verify release checks", state: state.executionRequested ? ("active" as const) : state.approved ? ("pending" as const) : releaseReady ? ("completed" as const) : ("active" as const), detail: checks },
    { id: "respond", stage: "respond" as const, title: "Prepare release response", state: "pending" as const },
  ];
  return {
    pluginId: PLUGIN_ID,
    workflowId: "preflight.release-review",
    title: "Release review",
    currentStage: state.executionRequested ? "verify" : state.approved ? "execute" : releaseReady ? "approve" : "verify",
    refreshedAt: new Date().toISOString(),
    steps,
    evidence: [{ id: "release-checks", title: "Release checks", kind: "check", status: releaseReady ? "positive" : "warning", detail: checks }],
    actions: state.executionRequested
      ? []
      : state.approved
        ? [{ id: "execute", title: "Execute release pipeline", tone: "primary" }]
        : [{ id: "approve", title: "Approve release action", tone: "primary" }],
  };
}

export type CockpitViewModel = { navigation: readonly string[]; metrics: { apps: number; releasePassing: number; releaseTotal: number } };
export type SurfaceCard =
  | { kind: "metric"; id: string; title: string; value: string; detail?: string; status?: "neutral" | "positive" | "warning" | "negative" }
  | { kind: "list"; id: string; title: string; items: readonly { id: string; title: string; detail?: string; status?: "neutral" | "positive" | "warning" | "negative" }[] };
export type SurfaceModel = { pluginId: string; navigationId: string; title: string; refreshedAt: string; cards: readonly SurfaceCard[] };

/** A Preflight request failure whose message is safe to show in a view: no URL or response body. */
export class PreflightApiError extends Error {
  constructor(
    readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "PreflightApiError";
  }
}

type Transport = { endpoint: string; token: string; fetchImpl: FetchLike; timeoutMs: number };

async function request(input: Transport, method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  let response: Response;
  try {
    response = await input.fetchImpl(`${input.endpoint.replace(/\/+$/u, "")}${path}`, {
      method,
      signal: AbortSignal.timeout(input.timeoutMs),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new PreflightApiError(undefined, `Preflight did not respond within ${Math.round(input.timeoutMs / 1000)}s`);
    }
    throw new PreflightApiError(undefined, "Preflight could not be reached");
  }
  const route = `${method} ${path.split("?")[0]}`;
  if (response.status >= 500) throw new PreflightApiError(response.status, `Preflight is temporarily unavailable (${response.status})`);
  if (response.status === 401 || response.status === 403) throw new PreflightApiError(response.status, `Preflight rejected the token (${response.status}). Check PREFLIGHT_TOKEN.`);
  if (!response.ok) throw new PreflightApiError(response.status, `Preflight ${route} failed (${response.status})`);
  try {
    return await response.json();
  } catch {
    throw new PreflightApiError(response.status, `Preflight ${route} returned an invalid response`);
  }
}

const count = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

export function normalizePreflightSnapshot(value: any): PreflightSnapshot {
  return {
    apps: Array.isArray(value?.apps) ? value.apps.map((app: any) => ({ id: String(app.id), name: String(app.name ?? app.slug ?? app.id), status: String(app.status ?? "unknown") })) : [],
    release: { passing: count(value?.releaseStatus?.passing), total: count(value?.releaseStatus?.total) },
  };
}
export function buildCockpitViewModel(snapshot: PreflightSnapshot): CockpitViewModel {
  return { navigation: ["apps", "cockpit", "builds", "proof", "releases", "runners"], metrics: { apps: snapshot.apps.length, releasePassing: snapshot.release.passing, releaseTotal: snapshot.release.total } };
}
export function buildSurfaceModel(snapshot: PreflightSnapshot, navigationId = "preflight.cockpit"): SurfaceModel {
  return {
    pluginId: PLUGIN_ID,
    navigationId,
    title: "Release readiness",
    refreshedAt: new Date().toISOString(),
    cards: [
      { kind: "metric", id: "apps", title: "Apps", value: `${snapshot.apps.length}` },
      { kind: "metric", id: "release-health", title: "Release checks", value: `${snapshot.release.passing}/${snapshot.release.total}`, status: isReleaseReady(snapshot) ? "positive" : "warning" },
      { kind: "list", id: "apps-list", title: "Registered apps", items: snapshot.apps.map((app) => ({ id: app.id, title: app.name, detail: app.status, status: app.status === "ready" ? ("positive" as const) : ("warning" as const) })) },
    ],
  };
}

export function createPreflightClient(input: { endpoint: string; token: string; fetchImpl?: FetchLike; timeoutMs?: number }) {
  const transport: Transport = { endpoint: input.endpoint, token: input.token, fetchImpl: input.fetchImpl ?? fetch, timeoutMs: input.timeoutMs ?? REQUEST_TIMEOUT_MS };
  return {
    async snapshot(platform = "ios"): Promise<PreflightSnapshot> {
      const apps = await request(transport, "GET", "/api/preflight/v1/apps");
      const releaseStatus = await request(transport, "GET", `/api/preflight/v1/release-status?platform=${encodeURIComponent(platform)}`);
      return normalizePreflightSnapshot({ apps: apps?.apps ?? apps?.data?.apps ?? apps, releaseStatus: releaseStatus?.releaseStatus ?? releaseStatus?.data?.releaseStatus ?? releaseStatus });
    },
    async startRelease(body: { platform?: string }): Promise<{ releaseId?: string }> {
      const result = await request(transport, "POST", "/api/preflight/v1/releases", body);
      const releaseId = result?.releaseId ?? result?.data?.releaseId ?? result?.id;
      return releaseId === undefined || releaseId === null ? {} : { releaseId: String(releaseId) };
    },
  };
}
export type PreflightClient = ReturnType<typeof createPreflightClient>;

export function normalizePollingSeconds(value: number | undefined): number {
  const seconds = value === undefined || !Number.isFinite(value) ? 60 : value;
  return Math.min(3600, Math.max(15, Math.floor(seconds)));
}
export function createPollingCoordinator<T>(input: { refresh: () => Promise<T>; intervalSeconds?: number; onError?: (error: unknown) => void }) {
  let cached: T | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  const interval = normalizePollingSeconds(input.intervalSeconds) * 1000;
  const tick = async () => {
    if (!active) return;
    try {
      cached = await input.refresh();
    } catch (error) {
      input.onError?.(error);
    } finally {
      if (active) timer = setTimeout(tick, interval);
    }
  };
  return {
    get snapshot() {
      return cached;
    },
    async refresh() {
      cached = await input.refresh();
      return cached;
    },
    /** Polls on the interval; the first refresh runs after one interval when `immediate` is false. */
    start(options: { immediate?: boolean } = {}) {
      active = true;
      if (options.immediate === false) timer = setTimeout(tick, interval);
      else void tick();
    },
    stop() {
      active = false;
      if (timer) clearTimeout(timer);
    },
  };
}
