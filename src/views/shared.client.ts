import { createViewBridge, toolData, type HostContext, type ViewBridge } from "./bridge.ts";
import { buildReviewWorkflow } from "../preflight.ts";
import { esc, renderReview, type ExecuteData, type ReviewData } from "./render.ts";

// host-context-changed may carry only the changed fields, so merge them.
export function startView(name: string): ViewBridge {
  const bridge = createViewBridge(window as never, { name, version: "0.3.0" });
  let context: HostContext = {};
  bridge.onHostContext = (update) => {
    context = { ...context, ...update };
    if (context.theme) document.documentElement.dataset.theme = context.theme;
  };
  new ResizeObserver(() => bridge.sendSize(document.documentElement.scrollWidth, document.documentElement.scrollHeight)).observe(document.body);
  return bridge;
}

export const errorText = (result: { content?: readonly { type: string; text?: string }[] }, fallback: string) =>
  result.content?.find((part) => part.type === "text")?.text ?? fallback;

// Release review controller, shared by the standalone review view and the
// inline review pane of the readiness view.
export function mountReview(bridge: ViewBridge, root: HTMLElement) {
  let data: ReviewData | undefined;
  let platform: string | undefined;
  let busy = false;
  let error: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const draw = () => {
    if (data) root.innerHTML = renderReview(data, { busy, ...(error ? { error } : {}) });
    else if (error) root.innerHTML = `<p class="error" role="alert">${esc(error)}</p>`;
    else if (busy) root.innerHTML = `<p class="row-detail">Loading release review…</p>`;
  };
  const schedule = () => {
    clearTimeout(timer);
    // Keep polling while an executed release is being verified.
    if (data?.workflow.currentStage === "verify" && data.state.executionRequested) timer = setTimeout(() => void refresh(), data.pollSeconds * 1000);
  };
  const run = async (task: () => Promise<void>) => {
    busy = true;
    error = undefined;
    draw();
    try {
      await task();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    busy = false;
    draw();
    schedule();
  };
  const reload = async () => {
    data = toolData<ReviewData>(await bridge.callTool("preflight_release_review", platform ? { platform } : {}));
  };
  const refresh = () => run(reload);

  root.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
    if (!action || !data) return;
    const args = { platform: data.platform };
    if (action === "refresh-review") void refresh();
    if (action === "approve") void run(async () => (toolData(await bridge.callTool("preflight_release_approve", args)), reload()));
    if (action === "execute")
      void run(async () => {
        const executed = toolData<ExecuteData>(await bridge.callTool("preflight_release_execute", args));
        if (!("refreshError" in executed)) {
          data = executed;
          return;
        }
        // Queued, but Preflight's status read failed: show the recorded
        // release and try the refresh once more.
        if (data) data = { ...data, state: executed.state, workflow: buildReviewWorkflow(data.snapshot, executed.state) };
        await reload().catch((cause) => {
          throw new Error(`Release requested, but the review could not be refreshed: ${cause instanceof Error ? cause.message : String(cause)}`);
        });
      });
    if (action === "reset") void run(async () => (toolData(await bridge.callTool("preflight_release_reset", args)), reload()));
  });

  return {
    show(next: ExecuteData) {
      // An execute result without a refreshed review: load it ourselves.
      if ("refreshError" in next) {
        platform = next.platform;
        return void refresh();
      }
      data = next;
      platform = next.platform;
      error = undefined;
      draw();
      schedule();
    },
    fail(message: string) {
      error = message;
      draw();
    },
    load(nextPlatform: string) {
      platform = nextPlatform;
      return refresh();
    },
  };
}
