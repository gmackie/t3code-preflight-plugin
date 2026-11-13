// Test fixtures: a fake Preflight API on a local port and an MCP client wired
// to the plugin server over an in-memory transport.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { createPreflightClient } from "./preflight.ts";
import { createPreflightMcpServer } from "./server.ts";
import { memoryReviewStore, type ReleaseReviewStore } from "./state.ts";

export const TOKEN = "test-token";

export function fakePreflight(options: { failWith?: number; release?: { passing: number; total: number } } = {}) {
  const releases: { platform?: string }[] = [];
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}${url.search}`);
      if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) return Response.json({ error: "unauthorized" }, { status: 401 });
      if (options.failWith) return new Response(`upstream exploded at ${url.href}`, { status: options.failWith });
      if (request.method === "GET" && url.pathname === "/api/preflight/v1/apps")
        return Response.json({ apps: [{ id: "app-1", name: "T3 <Mobile>", status: "ready" }, { id: "app-2", slug: "t3-desktop", status: "building" }] });
      if (request.method === "GET" && url.pathname === "/api/preflight/v1/release-status")
        return Response.json({ releaseStatus: options.release ?? { passing: 4, total: 4 }, platform: url.searchParams.get("platform") });
      if (request.method === "POST" && url.pathname === "/api/preflight/v1/releases") {
        releases.push((await request.json()) as { platform?: string });
        return Response.json({ releaseId: `rel-${releases.length}` }, { status: 202 });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  return { url: server.url.href.replace(/\/$/, ""), releases, requests, stop: () => server.stop(true) };
}

export async function connectedClient(options: { endpoint?: string; token?: string | null; state?: ReleaseReviewStore; problem?: string } = {}) {
  const token = options.token === null ? undefined : (options.token ?? TOKEN);
  const server = createPreflightMcpServer({
    client: options.endpoint && token ? createPreflightClient({ endpoint: options.endpoint, token, timeoutMs: 2_000 }) : undefined,
    ...(options.problem ? { problem: options.problem } : {}),
    state: options.state ?? memoryReviewStore(),
    pollSeconds: 30,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-host", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, server };
}
