# Preflight manifest v2 (T3CODE-75)

`t3-plugin.json` follows the MCP-native plugin model from T3CODE-74, the same shape as the Bob plugin (v0.2.1). T3 loads this manifest into its server-owned MCP registry. The v1 manifest's last version is at commit dd1a7d1.

## Shape

- `mcpServer` reuses `McpServerConfig` and `McpServerVariable` from Settings → Tools (`packages/contracts/src/agentTools.ts`):
  - `name`: `preflight`.
  - `transport`: stdio, `bun ${pluginRoot}/src/mcp.ts`, with `env` as `McpServerVariable[]`.
  - `PREFLIGHT_TOKEN` is `sensitive`.
- `contributes.panels[]`, both rendering `ui://preflight/readiness.html` and running `preflight_readiness` on open:
  - `preflight-readiness` (`scope: project`): registered apps, release check metrics, and an inline release review.
  - `preflight-releases` (`scope: thread`): the same release status beside a thread. Release status is not thread-specific, so the view ignores `hostContext.t3`.
- `contributes.commands[]` open those panels.
- `t3Tools` is `[]`: the v1 plugin requested no T3 capability, and Preflight never calls back into T3.

## v1 → v2 mapping

| v1 | v2 |
|---|---|
| `runtime` (managed-app, `bun src/stdio.ts`, RPC `surface.get` / `workflow.get` / `action.execute`) | `mcpServer.transport` (stdio, `bun ${pluginRoot}/src/mcp.ts`) |
| `navigation[preflight.apps]`, `[preflight.cockpit]`, `[preflight.releases]` | Tool `preflight_readiness` and its view (apps list, release check metrics) |
| `navigation[preflight.builds]`, `[preflight.proof]`, `[preflight.runners]` | Removed, see below |
| `panels[preflight.readiness]` (project) | `panels[preflight-readiness]`, `scope: project` |
| `panels[preflight.releases]` (thread.sidePanel) | `panels[preflight-releases]`, `scope: thread` |
| `workflows[preflight.release-review]` (thread.main) | Tool `preflight_release_review` with its own `ui://preflight/release-review.html` view |
| action `approve` | Tool `preflight_release_approve`, `visibility: ["app"]` |
| action `execute` | Tool `preflight_release_execute`, `visibility: ["model", "app"]`, gated on approval |
| (none) | Tool `preflight_release_reset`, `visibility: ["app"]`: withdraw an approval or start the next review |
| `settings[preflight.endpoint]` | `PREFLIGHT_ENDPOINT` (default `https://preflight.forgegraf.com`) |
| `settings[preflight.token]`, `capabilities.secrets.read [PREFLIGHT_TOKEN]` | `PREFLIGHT_TOKEN`, `sensitive` |
| `settings[preflight.polling-seconds]` | `PREFLIGHT_POLL_SECONDS` (clamped to 15–3600, default 60); the readiness view polls on it |
| `settingsPanels[preflight.connection]` | Dropped: T3 shows `transport.env` titles in the plugin's install form |
| `T3_PLUGIN_STATE_FILE` (single global approval) | `PREFLIGHT_PLUGIN_STATE_PATH`, SQLite, one row per platform |
| `capabilities.network.connect [preflight.forgegraf.com]` | Dropped: the server process makes the calls to `PREFLIGHT_ENDPOINT`, and views go through `tools/call` |
| `capabilities.ui.embed` | Implied by `panels` |
| `hooks [turn.settled, runtime.error]` | Removed, see below |

## Removed v1 features

- **`hooks` (`turn.settled`, `runtime.error`).** v2 has no hooks. The v1 runtime declared them but never handled a hook event, so no behaviour is lost. A readiness refresh after a turn is now on demand: agents call `preflight_readiness`, and the panel polls.
- **Builds, Proof and Runners navigation.** In v1 these three entries returned the same readiness cards as Cockpit; Preflight's stable API (`/api/preflight/v1/apps`, `/release-status`, `/releases`) has no builds, proof or runner endpoint. Adding tools for them would mean inventing data, so they are dropped until Preflight exposes those endpoints.
- **Fake success without credentials.** v1 answered `execute` with "Release pipeline queued." when no endpoint/token was set. Every tool now returns an error naming the missing variable instead.

## Server rules

- **Visibility.** Every tool a view calls includes `"app"`. `preflight_readiness`, `preflight_release_review` and `preflight_release_execute` are `["model", "app"]`; `preflight_release_approve` and `preflight_release_reset` are `["app"]`, so only a human in a view can approve or reset a release.
- **Errors.** Requests time out after 15 s. 5xx responses become `Preflight is temporarily unavailable (<status>)`, 401/403 point at `PREFLIGHT_TOKEN`; no URL or response body reaches a view.
- **Stateless processes.** T3 runs one stdio copy per agent session plus one in its pool, so a panel's approval and an agent's execute can land in different processes. Approval lives in the SQLite file at `PREFLIGHT_PLUGIN_STATE_PATH` (default `$XDG_STATE_HOME/t3code-preflight-plugin/state.sqlite`, WAL, `busy_timeout`); `server.test.ts` covers approving in one copy and executing from another.

## Open questions

1. **Platforms.** v1 hard-coded `platform=ios`. The tools take an optional `platform` (default `ios`); the panels always open with the default. A per-install default platform would need a new variable.
2. **Shared state file.** As with Bob, approval depends on every copy seeing the same `HOME`/`XDG_STATE_HOME` (or the same `PREFLIGHT_PLUGIN_STATE_PATH`).
