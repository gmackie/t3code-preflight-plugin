import { expect, it } from "bun:test";
import manifest from "../t3-plugin.json";

const endpoint = manifest.mcpServer.transport.url;

it("connects to Preflight's OAuth MCP server without a stored token", () => {
  const { transport } = manifest.mcpServer;
  expect(transport.type).toBe("http");
  expect(endpoint).toBe("https://preflight.forgegraf.com/api/mcp");
  expect(transport.auth).toEqual({ type: "oauth", scopes: ["preflight:read", "preflight:build", "preflight:release-review"] });
  // Store uploads (submit_build, preflight:release) stay out of agent reach.
  expect(transport.auth.scopes).not.toContain("preflight:release");
  expect(JSON.stringify(manifest)).not.toContain("PREFLIGHT_TOKEN");
});

it("opens the existing readiness panels and the release review", () => {
  const review = manifest.contributes.panels.find((panel) => panel.id === "preflight-release-review");
  expect(review).toMatchObject({
    scope: "thread",
    resourceUri: "ui://preflight/release-review.html",
    tool: { name: "preflight_release_review", arguments: {} },
  });
  const readiness = manifest.contributes.panels.filter((panel) => panel.id !== "preflight-release-review");
  expect(readiness.map((panel) => panel.id).sort()).toEqual(["preflight-readiness", "preflight-releases"]);
  for (const panel of readiness) {
    expect(panel.resourceUri).toBe("ui://preflight/readiness.html");
    expect(panel.tool.name).toBe("preflight_readiness");
  }
  const panels = new Set(manifest.contributes.panels.map((panel) => panel.id));
  for (const command of manifest.contributes.commands) expect(panels.has(command.panel)).toBe(true);
});

// Live discovery: the endpoint challenges for OAuth and advertises the scopes
// the manifest asks for. Skipped offline with PREFLIGHT_OFFLINE=1.
it.skipIf(process.env.PREFLIGHT_OFFLINE === "1")("advertises OAuth discovery for the requested scopes", async () => {
  const challenge = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  expect(challenge.status).toBe(401);
  expect(challenge.headers.get("www-authenticate")).toContain("resource_metadata=");
  const resource = (await (await fetch(new URL("/.well-known/oauth-protected-resource/api/mcp", endpoint))).json()) as { resource: string; scopes_supported: string[] };
  expect(resource.resource).toBe(endpoint);
  for (const scope of manifest.mcpServer.transport.auth.scopes) expect(resource.scopes_supported).toContain(scope);
});
