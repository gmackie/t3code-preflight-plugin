import { homedir } from "node:os";
import { join } from "node:path";

import { normalizePollingSeconds } from "./preflight.ts";

// The v1 settings (preflight.endpoint, preflight.token, preflight.polling-seconds)
// map 1:1 onto these env vars, declared under mcpServer.transport.env in the
// v2 manifest so T3 collects them at install and keeps the token in its secret store.
export type PreflightConfig = {
  readonly endpoint: string;
  readonly token?: string;
  readonly pollSeconds: number;
  readonly statePath: string;
  /** Set when the plugin cannot reach Preflight; tools return it as their error. */
  readonly problem?: string;
};

export const DEFAULT_ENDPOINT = "https://preflight.forgegraf.com";

// Never throws: a misconfigured plugin still starts, so its panels can say what to fix.
export function loadConfig(env: Record<string, string | undefined> = process.env): PreflightConfig {
  const endpoint = (env.PREFLIGHT_ENDPOINT?.trim() || DEFAULT_ENDPOINT).replace(/\/+$/u, "");
  const token = env.PREFLIGHT_TOKEN?.trim();
  const poll = env.PREFLIGHT_POLL_SECONDS?.trim();
  const config = {
    endpoint,
    ...(token ? { token } : {}),
    pollSeconds: normalizePollingSeconds(poll ? Number(poll) : undefined),
    statePath: env.PREFLIGHT_PLUGIN_STATE_PATH?.trim() || defaultStatePath(env),
  };
  const problem = !validHttpUrl(endpoint)
    ? "PREFLIGHT_ENDPOINT must be an http(s) URL, e.g. https://preflight.forgegraf.com. Update it in the Preflight plugin settings."
    : !token
      ? "Preflight is not configured: set PREFLIGHT_TOKEN (Preflight token) in the Preflight plugin settings."
      : undefined;
  return problem ? { ...config, problem } : config;
}

function validHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

// T3 does not hand plugins a data directory, so state defaults to the XDG state
// dir and never to T3's own userdata.
function defaultStatePath(env: Record<string, string | undefined>): string {
  const base = env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
  return join(base, "t3code-preflight-plugin", "state.sqlite");
}
