import { expect, it } from "bun:test";
import manifest from "../t3-plugin.json";

const endpoint = manifest.mcpServer.transport.url;

it("connects to Preflight's OAuth MCP server without a stored token", () => {
  const { transport } = manifest.mcpServer;
  expect(transport.type).toBe("http");
  expect(endpoint).toBe("https://preflight.forgegraf.com/api/mcp");
  expect(transport.auth).toEqual({ type: "oauth", scopes: ["preflight:read", "preflight:build"] });
  // Store uploads (submit_build, preflight:release) stay out of agent reach.
  expect(transport.auth.scopes).not.toContain("preflight:release");
  expect(JSON.stringify(manifest)).not.toContain("PREFLIGHT_TOKEN");
});

it("opens every panel with the readiness tool and view", () => {
  for (const panel of manifest.contributes.panels) {
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
