# T3 Code Preflight plugin

Preflight release cockpit for T3 Code: app readiness, release checks, and a human-approved release review backed by Preflight's stable `/api/preflight/v1` API.

The plugin is an MCP server (`src/mcp.ts`, stdio) described by a v2 manifest (`t3-plugin.json`). The managed-app runtime and plugin RPC were removed in T3CODE-75; T3 builds that only load v1 manifests cannot load this version.

## MCP server

Built on the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). Views are MCP Apps: `ui://` HTML resources with the `text/html;profile=mcp-app` MIME type.

- `preflight_readiness` lists registered apps and the release checks for a platform (default `ios`), and renders `ui://preflight/readiness.html`. The view refreshes every `PREFLIGHT_POLL_SECONDS` and can open the release review inline.
- `preflight_release_review` shows the review stages, check evidence and next action, and renders `ui://preflight/release-review.html`.
- `preflight_release_approve` records human approval. Only a view can call it.
- `preflight_release_execute` starts the release pipeline (`POST /api/preflight/v1/releases`) once that platform is approved.
- `preflight_release_reset` withdraws an approval or starts the next review. Only a view can call it.

Panels: `preflight-readiness` (project) and `preflight-releases` (thread). Commands open both.

### Configuration

| Env var | Old setting | Notes |
|---|---|---|
| `PREFLIGHT_ENDPOINT` | `preflight.endpoint` | default `https://preflight.forgegraf.com` |
| `PREFLIGHT_TOKEN` | `preflight.token` | secret, required |
| `PREFLIGHT_POLL_SECONDS` | `preflight.polling-seconds` | 15–3600, default 60 |
| `PREFLIGHT_PLUGIN_STATE_PATH` | (new) | SQLite release review state, default `$XDG_STATE_HOME/t3code-preflight-plugin/state.sqlite`, shared by every plugin process |

Without a token the server still starts; its tools return an error that says what to set.

### Run it

```sh
bun install
bun test                 # domain, MCP client, view and stdio install tests
bun run typecheck
PREFLIGHT_TOKEN=... bun run inspect   # official MCP Inspector (Apps tab)
```

Install this directory through T3's plugin installer after `bun install --frozen-lockfile`, and fill in the token on the connected server. Web, desktop and mobile can open its panels.

See `docs/manifest-v2.md` for the v1 → v2 mapping, removed features, and open questions.
