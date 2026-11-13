#!/usr/bin/env bun
// Stdio entry point for the MCP-native Preflight plugin (manifest v2 `mcpServer`).
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { loadConfig } from "./config.ts";
import { createPreflightClient } from "./preflight.ts";
import { createPreflightMcpServer } from "./server.ts";
import { sqliteReviewStore } from "./state.ts";

const config = loadConfig();
mkdirSync(dirname(config.statePath), { recursive: true });

const server = createPreflightMcpServer({
  client: config.problem || !config.token ? undefined : createPreflightClient({ endpoint: config.endpoint, token: config.token }),
  ...(config.problem ? { problem: config.problem } : {}),
  state: sqliteReviewStore(new Database(config.statePath, { create: true })),
  pollSeconds: config.pollSeconds,
});
await server.connect(new StdioServerTransport());
