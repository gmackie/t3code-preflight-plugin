import { describe, expect, it } from "bun:test";

import { buildReviewWorkflow, buildSurfaceModel, type PreflightSnapshot } from "../preflight.ts";
import { renderReadiness, renderReview } from "./render.ts";

const snapshot: PreflightSnapshot = { apps: [{ id: "a1", name: "T3 <script>alert(1)</script>", status: "ready" }, { id: "a2", name: "Desktop", status: "building" }], release: { passing: 2, total: 3 } };
const review = (state: { approved: boolean; executionRequested: boolean; releaseId?: string }) => ({ platform: "ios", snapshot, state, workflow: buildReviewWorkflow(snapshot, state), pollSeconds: 60 });

describe("view renderers", () => {
  it("renders readiness cards and escapes Preflight content", () => {
    const html = renderReadiness({ platform: "ios", snapshot, surface: buildSurfaceModel(snapshot), ready: false, pollSeconds: 60, refreshedAt: "2026-11-13T00:00:00Z" });
    expect(html).toContain("T3 &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('<div class="metric-value tone-warning">2/3</div>');
    expect(html).toContain('pill-positive">ready');
    expect(html).toContain('pill-warning">building');
    expect(html).toContain('data-action="review"');
  });

  it("says when no apps are registered and shows refresh errors", () => {
    const empty = { apps: [], release: { passing: 0, total: 0 } };
    const html = renderReadiness({ platform: "ios", snapshot: empty, surface: buildSurfaceModel(empty), ready: false, pollSeconds: 60, refreshedAt: "2026-11-13T00:00:00Z" }, { error: "Refresh failed: <down>" });
    expect(html).toContain("No apps are registered in Preflight.");
    expect(html).toContain('role="alert">Refresh failed: &lt;down&gt;');
  });

  it("offers approve, then execute or withdraw, then a new review", () => {
    expect(renderReview(review({ approved: false, executionRequested: false }))).toContain('data-action="approve"');
    const approved = renderReview(review({ approved: true, executionRequested: false }), { busy: true, error: "Preflight is temporarily unavailable (503)" });
    expect(approved).toContain('data-action="execute" disabled');
    expect(approved).toContain("Withdraw approval");
    expect(approved).toContain('role="alert">Preflight is temporarily unavailable (503)');
    const executed = renderReview(review({ approved: true, executionRequested: true, releaseId: "rel-9" }));
    expect(executed).not.toContain('data-action="execute"');
    expect(executed).toContain("rel-9");
    expect(executed).toContain('data-action="reset"');
    expect(executed).toContain("Start a new review");
  });
});
