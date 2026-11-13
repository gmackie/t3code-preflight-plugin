import { createPollingCoordinator } from "../preflight.ts";
import { toolData } from "./bridge.ts";
import { esc, renderReadiness, type ReadinessData } from "./render.ts";
import { errorText, mountReview, startView } from "./shared.client.ts";

// Project panel (apps and release checks) and thread panel (release status)
// both render this view. The panel's `tool` runs preflight_readiness on open;
// the host may also deliver an inline tool call's result.
const bridge = startView("preflight-readiness");
const root = document.getElementById("app")!;
let args: Record<string, unknown> = {};
let data: ReadinessData | undefined;
let error: string | undefined;
let review: ReturnType<typeof mountReview> | undefined;
let poller: ReturnType<typeof createPollingCoordinator<ReadinessData>> | undefined;

function draw() {
  if (!data) {
    root.innerHTML = error ? `<p class="error" role="alert">${esc(error)}</p><div class="actions"><button type="button" data-action="refresh">Retry</button></div>` : "Loading…";
    return;
  }
  // Keep the review pane (and its state) across refreshes.
  const pane = root.querySelector<HTMLElement>("[data-role=review]");
  root.innerHTML = renderReadiness(data, error ? { error: `Refresh failed: ${error}` } : {});
  if (pane) root.querySelector("[data-role=review]")!.replaceWith(pane);
  else review = mountReview(bridge, root.querySelector<HTMLElement>("[data-role=review]")!);
}

async function load(): Promise<ReadinessData> {
  const result = await bridge.callTool("preflight_readiness", args);
  if (result.isError) throw new Error(errorText(result, "Preflight readiness failed to load."));
  return toolData<ReadinessData>(result);
}

function show(next: ReadinessData) {
  data = next;
  error = undefined;
  draw();
  if (!poller) {
    poller = createPollingCoordinator({
      intervalSeconds: next.pollSeconds,
      refresh: async () => {
        // Skip work while the panel is hidden; the next tick tries again.
        if (document.visibilityState === "hidden" && data) return data;
        const fresh = await load();
        show(fresh);
        return fresh;
      },
      onError: (cause) => {
        error = cause instanceof Error ? cause.message : String(cause);
        draw();
      },
    });
    poller.start({ immediate: false });
  }
}

async function refresh() {
  try {
    show(await load());
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    draw();
  }
}

root.addEventListener("click", (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
  if (action === "refresh") void refresh();
  if (action === "review" && data) void review?.load(data.platform);
});

bridge.onToolInput = (input) => {
  args = input;
};
bridge.onToolResult = (result) => {
  if (result.isError) {
    error = errorText(result, "Preflight readiness failed to load.");
    data = undefined;
    draw();
    return;
  }
  show(toolData<ReadinessData>(result));
};
// A panel opened without a tool result fetches its own data.
void bridge.connect().then(() => setTimeout(() => void (data || error ? undefined : refresh()), 250));
