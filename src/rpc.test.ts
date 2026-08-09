import { describe, expect, test } from "bun:test";
import { createRpcHandler } from "./rpc.ts";

describe("Preflight RPC", () => {
  test("serves app readiness as native surface cards", async () => {
    const handler = createRpcHandler({ snapshot: { apps: [], release: { passing: 1, total: 1 } }, refresh: async () => ({ apps: [], release: { passing: 0, total: 0 } }) });
    await expect(handler("surface.get", { navigationId: "preflight.releases" })).resolves.toMatchObject({ ok: true, result: { pluginId: "com.t3code.preflight", navigationId: "preflight.releases" } });
  });
});
