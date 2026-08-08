import { describe, expect, test } from "bun:test";
import { createPollingCoordinator, createPreflightClient, normalizePreflightSnapshot } from "./preflight.ts";

describe("Preflight adapter", () => {
  test("normalizes apps and release health", () => {
    expect(normalizePreflightSnapshot({ apps: [{ id: "a", name: "T3", status: "ready" }], releaseStatus: { passing: 2, total: 3 } })).toEqual({
      apps: [{ id: "a", name: "T3", status: "ready" }],
      release: { passing: 2, total: 3 },
    });
  });

  test("requests the stable read-only Preflight endpoints", async () => {
    const urls: string[] = [];
    const client = createPreflightClient({ endpoint: "https://preflight.example", token: "secret", fetchImpl: async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify(input.toString().endsWith("/apps") ? { apps: [] } : { apps: [], platform: "ios" }), { status: 200 });
    } });
    await client.snapshot();
    expect(urls).toEqual(["https://preflight.example/api/preflight/v1/apps", "https://preflight.example/api/preflight/v1/release-status?platform=ios"]);
  });

  test("caches the latest refresh result", async () => {
    const coordinator = createPollingCoordinator({ refresh: async () => ({ apps: [], release: { passing: 1, total: 1 } }) });
    expect(await coordinator.refresh()).toEqual({ apps: [], release: { passing: 1, total: 1 } });
    expect(coordinator.snapshot?.release.passing).toBe(1);
  });
});
