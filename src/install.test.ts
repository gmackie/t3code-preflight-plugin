import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import manifest from "../t3-plugin.json";

it("launches the installed manifest from another directory and serves its panels", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "preflight-install-"));
  const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
  // Install-time env: the manifest defaults, with no token yet.
  const env = Object.fromEntries(manifest.mcpServer.transport.env.map((variable) => [variable.name, variable.value]));
  const transport = new StdioClientTransport({
    command: manifest.mcpServer.transport.command,
    args: manifest.mcpServer.transport.args.map((arg) => arg.replaceAll("${pluginRoot}", root)),
    cwd,
    env: { ...env, PATH: process.env.PATH ?? "", PREFLIGHT_PLUGIN_STATE_PATH: join(cwd, "state.sqlite") },
  });
  const client = new Client({ name: "installation-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    const resources = (await client.listResources()).resources;
    for (const panel of manifest.contributes.panels) {
      expect(tools).toContain(panel.tool.name);
      expect(resources.some((resource) => resource.uri === panel.resourceUri)).toBe(true);
      const view = await client.readResource({ uri: panel.resourceUri });
      expect(view.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
      expect(view.contents[0]).toHaveProperty("text", expect.stringContaining("ui/initialize"));
    }
    // Without a token the panel tool explains what to configure.
    const result = (await client.callTool({ name: "preflight_readiness", arguments: {} })) as { isError?: boolean; content: { text?: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("PREFLIGHT_TOKEN");
  } finally {
    await client.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
