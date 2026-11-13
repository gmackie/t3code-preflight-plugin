// Pure HTML renderers shared by the ui:// views (bundled into the browser) and
// the tests. All dynamic text goes through esc().
import type { PreflightSnapshot, ReviewWorkflowModel, SurfaceCard, SurfaceModel } from "../preflight.ts";
import type { ReleaseReviewState } from "../state.ts";

export type ReadinessData = {
  platform: string;
  snapshot: PreflightSnapshot;
  surface: SurfaceModel;
  ready: boolean;
  pollSeconds: number;
  refreshedAt: string;
};

export type ReviewData = {
  platform: string;
  snapshot: PreflightSnapshot;
  state: ReleaseReviewState;
  workflow: ReviewWorkflowModel;
  pollSeconds: number;
  release?: { releaseId?: string };
};

export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const time = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");

function pill(label: string, tone: string): string {
  return `<span class="pill pill-${esc(tone)}">${esc(label)}</span>`;
}

function card(item: SurfaceCard): string {
  if (item.kind === "metric") {
    return `<div class="metric" data-card="${esc(item.id)}"><div class="metric-title">${esc(item.title)}</div><div class="metric-value${item.status ? ` tone-${esc(item.status)}` : ""}">${esc(item.value)}</div>${item.detail ? `<div class="row-detail">${esc(item.detail)}</div>` : ""}</div>`;
  }
  const rows = item.items.length
    ? item.items
        .map((row) => `<li class="row"><div class="row-main"><div class="row-title">${esc(row.title)}</div><div class="row-meta">${row.detail ? pill(row.detail, row.status ?? "neutral") : ""}<span class="mono">${esc(row.id)}</span></div></div></li>`)
        .join("\n")
    : `<li class="empty">No apps are registered in Preflight.</li>`;
  return `<section aria-label="${esc(item.title)}" data-card="${esc(item.id)}"><h2>${esc(item.title)} <span class="count">${item.items.length}</span></h2><ul>${rows}</ul></section>`;
}

export function renderReadiness(data: ReadinessData, options: { error?: string } = {}): string {
  const metrics = data.surface.cards.filter((item) => item.kind === "metric");
  const lists = data.surface.cards.filter((item) => item.kind === "list");
  return `<header>
  <h1>${esc(data.surface.title)} <span class="mono">${esc(data.platform)}</span></h1>
  <div class="header-meta"><span data-role="status">Refreshed ${esc(time(data.refreshedAt))} · every ${esc(data.pollSeconds)}s</span><button type="button" data-action="refresh">Refresh</button></div>
</header>
${options.error ? `<p class="error" role="alert">${esc(options.error)}</p>` : ""}
<div class="metrics">${metrics.map(card).join("")}</div>
${lists.map(card).join("\n")}
<div class="actions"><button type="button" data-action="review">Review ${esc(data.platform)} release</button></div>
<div data-role="review"></div>`;
}

const stepIcon: Record<ReviewWorkflowModel["steps"][number]["state"], string> = {
  pending: "○",
  active: "◐",
  completed: "●",
  blocked: "◌",
  failed: "✕",
};

export function renderReview(data: ReviewData, options: { busy?: boolean; error?: string } = {}): string {
  const { workflow, state } = data;
  const disabled = options.busy ? "disabled" : "";
  const steps = workflow.steps
    .map(
      (step) =>
        `<li class="step step-${esc(step.state)}"><span class="step-icon" aria-hidden="true">${stepIcon[step.state]}</span><div><div class="row-title">${esc(step.title)}</div>${step.detail ? `<div class="row-detail">${esc(step.detail)}</div>` : ""}</div><span class="sr">${esc(step.state)}</span></li>`,
    )
    .join("\n");
  const evidence = (workflow.evidence ?? [])
    .map((item) => `<li class="row"><div class="row-main"><div class="row-title">${esc(item.title)}</div><div class="row-meta">${pill(item.status, item.status)}${item.detail ? `<span>${esc(item.detail)}</span>` : ""}</div></div></li>`)
    .join("\n");
  const primary = (workflow.actions ?? [])
    .map((action) => `<button type="button" class="${action.tone === "primary" ? "primary" : ""}" data-action="${esc(action.id)}" ${disabled}>${esc(action.title)}</button>`)
    .join("");
  // The way back out of approve and execute.
  const reset = state.executionRequested
    ? `<button type="button" data-action="reset" ${disabled}>Start a new review</button>`
    : state.approved
      ? `<button type="button" data-action="reset" ${disabled}>Withdraw approval</button>`
      : "";
  const released = state.executionRequested
    ? `<p class="subject">${pill("release requested", "active")}${state.releaseId ? `<span class="mono">${esc(state.releaseId)}</span>` : ""}${state.updatedAt ? `<span class="row-detail">${esc(time(state.updatedAt))}</span>` : ""}</p>`
    : "";
  return `<header>
  <h1>${esc(workflow.title)} <span class="mono">${esc(data.platform)}</span></h1>
  <div class="header-meta"><span>Stage: <strong>${esc(workflow.currentStage)}</strong></span><button type="button" data-action="refresh-review">Refresh</button></div>
</header>
${released}
${options.error ? `<p class="error" role="alert">${esc(options.error)}</p>` : ""}
<ol class="steps">${steps}</ol>
${evidence ? `<section aria-label="Evidence"><h2>Evidence</h2><ul>${evidence}</ul></section>` : ""}
${primary || reset ? `<div class="actions">${primary}${reset}</div>` : ""}`;
}

export const STYLES = `
:root { color-scheme: light dark; --fg: #1f2328; --muted: #656d76; --bg: transparent; --line: #d0d7de; --accent: #0969da; --pos: #1a7f37; --neg: #cf222e; --warn: #9a6700; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
:root[data-theme="dark"] { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; --warn: #d29922; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; --warn: #d29922; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 12px; color: var(--fg); background: var(--bg); }
header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; }
h1 { font-size: 15px; margin: 0; } h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 16px 0 6px; }
.header-meta { display: flex; gap: 8px; align-items: center; color: var(--muted); }
ul, ol { list-style: none; margin: 0; padding: 0; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-top: 12px; }
.metric { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
.metric-title { color: var(--muted); font-size: 12px; } .metric-value { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.tone-positive { color: var(--pos); } .tone-warning { color: var(--warn); } .tone-negative { color: var(--neg); }
.row { display: flex; gap: 8px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); }
.row-main { flex: 1; min-width: 0; } .row-title { font-weight: 500; overflow-wrap: anywhere; }
.row-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: var(--muted); font-size: 12px; margin-top: 2px; }
.row-detail { color: var(--muted); font-size: 12px; margin-top: 2px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; font-weight: 400; color: var(--muted); }
.count { font-weight: 400; } .empty { color: var(--muted); padding: 8px 0; border-top: 1px solid var(--line); }
.pill { border: 1px solid currentColor; border-radius: 999px; padding: 0 7px; font-size: 11px; line-height: 17px; }
.pill-active { color: var(--accent); } .pill-positive { color: var(--pos); } .pill-negative { color: var(--neg); } .pill-warning { color: var(--warn); } .pill-neutral, .pill-muted { color: var(--muted); }
button { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); } button:disabled { opacity: .5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.steps { margin-top: 10px; } .step { display: flex; gap: 10px; padding: 6px 0; align-items: flex-start; }
.step-icon { width: 14px; text-align: center; color: var(--muted); } .step-active .step-icon { color: var(--accent); } .step-completed .step-icon { color: var(--pos); } .step-failed .step-icon { color: var(--neg); }
.step-pending .row-title { color: var(--muted); font-weight: 400; }
.actions { display: flex; gap: 8px; align-items: center; margin-top: 14px; flex-wrap: wrap; }
.subject { margin: 6px 0 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.error { color: var(--neg); } .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
[data-role="review"]:not(:empty) { margin-top: 16px; padding-top: 4px; border-top: 2px solid var(--line); }
`;
