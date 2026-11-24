# T3 Code Preflight plugin

Preflight release cockpit for T3 Code: app readiness and store release progress from Preflight.

Since 0.4.0 (PREFLT-78) the plugin is a manifest only, like the ForgeGraph plugin. `t3-plugin.json` points T3 at Preflight's remote MCP server, `https://preflight.forgegraf.com/api/mcp`, over Streamable HTTP with OAuth. There is no local process and no `PREFLIGHT_TOKEN` to paste.

## Connect

Install the plugin, then connect it in T3. T3 registers itself with Preflight (dynamic client registration, PKCE) and opens Preflight sign-in. Sign in with ForgeGraph, choose one workspace, and approve the scopes. Every tool works inside that workspace. Manage or revoke connections at `https://preflight.forgegraf.com/mcp/connections`.

The plugin requests these scopes:

| Scope | Tools |
| --- | --- |
| `preflight:read` | `preflight_readiness`, `list_apps`, `list_workflows`, `list_builds`, `list_workers`, `get_build_queue` |
| `preflight:build` | `start_build`, `cancel_build` |

It deliberately leaves out `preflight:release` (`submit_build`, store uploads), so agents in T3 cannot upload a build to TestFlight or the stores. Do store uploads in Preflight, or through a separate connection that a person approves.

## Panels

Both panels render `ui://preflight/readiness.html`, which the server serves as an MCP Apps view, and run `preflight_readiness` when they open:

- **App readiness** (`preflight-readiness`, project scope)
- **Release status** (`preflight-releases`, thread scope)

The view shows the workspace's apps and each store-bound app's release stage, next step and owner, with an iOS/Android toggle. It refreshes every 60 seconds. Its tool and view live in preflight-app (`apps/nextjs/src/lib/mcp/readiness.ts`).

## Test

```sh
bun test                      # manifest shape plus live OAuth discovery against production
PREFLIGHT_OFFLINE=1 bun test  # shape only
```

## History

Versions 0.3.x ran a local stdio MCP server (`bun src/mcp.ts`) authenticated with a pasted `PREFLIGHT_TOKEN`. That server's release approve/execute flow called `POST /api/preflight/v1/releases`, which Preflight never exposed, so it was dropped rather than ported. See `docs/manifest-v2.md` and commit 5a62c8f for that version.
