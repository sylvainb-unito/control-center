# Control Center

Local dev dashboard — worktrees, pull requests, tool shortcuts. Retrowave themed. Solo local use only (bound to `127.0.0.1`).

## Requirements

- macOS (launchd for the daemon)
- Node 22 LTS (`nvm use`)
- pnpm 9 (`corepack enable pnpm`)
- `gh` CLI authenticated (`gh auth login`) — required for the Pull Requests panel

## Dev

```bash
nvm use
pnpm install
pnpm dev
```

Opens two processes via `concurrently`:
- Vite on http://localhost:5173 (serves the UI)
- Hono on http://localhost:7778 (serves `/api/*` and `/logos/*`)

Vite proxies `/api` and `/logos` to the Hono process.

## Prod (daemon)

```bash
pnpm install
pnpm --filter @cc/web build      # produces web/dist
scripts/install-launchd.sh       # installs ~/Library/LaunchAgents/io.unito.control-center.plist
```

Open http://localhost:7777. Logs: `~/Library/Logs/control-center.log`.

The launchd agent runs the Hono server via `tsx` directly against TypeScript sources — no precompiled server bundle. The agent keeps the process alive (`KeepAlive`) and restarts on crash.

### Update after a pull

```bash
git pull
scripts/redeploy.sh   # pnpm install + rebuild web + launchctl kickstart
```

### Uninstall the daemon

```bash
scripts/uninstall-launchd.sh   # preserves logs
```

## Panels

Three panels ship in Spec 1:

| Panel          | Data source                             | Sources/destinations                         |
|----------------|-----------------------------------------|----------------------------------------------|
| Worktrees      | `git` CLI + filesystem                  | Scans `~/Workspace/*/.worktrees/*`           |
| Pull Requests  | GitHub GraphQL (`gh auth token`)        | Authored + review-requested PRs              |
| Shortcuts      | `config/shortcuts.json`                 | Tool URL tiles with logos                    |

### Customizing shortcuts

Edit `config/shortcuts.json` and refresh the browser tab. Drop SVG logos into `config/logos/` matching the `logo` field (e.g., `asana.svg`). Missing logos render as neon 2-letter placeholders.

### Adding a panel

1. Create `panels/<id>/` with `meta.ts`, `types.ts`, `api.ts`, `ui.tsx`, `ui.module.css`, `package.json`, `tsconfig.json`. Mirror an existing panel (worktrees is the richest reference).
2. Register the UI in `web/src/panels.ts` and the API in `server/src/routes.ts`.
3. Run `pnpm install && pnpm -r test`.

Panel load order is determined by `meta.order` (ascending).

## Testing

```bash
pnpm -r test     # all workspaces (31 tests)
pnpm check       # biome lint + format
pnpm fix         # biome autofix
```

## Architecture summary

- **Monorepo** via pnpm workspaces: `web/`, `server/`, `shared/`, `panels/*`.
- **Server**: Hono + pino. Runs via `tsx` in both dev and prod.
- **Web**: Vite + React 18 + TanStack Query. `@fontsource` for Orbitron / JetBrains Mono / VT323. Plain CSS theme (no Tailwind).
- **Panels**: co-located `{meta, types, api, ui}` in each `panels/<id>/` folder; explicit registries (`web/src/panels.ts`, `server/src/routes.ts`).
- **Error surface**: shared `Envelope<T>` type (`shared/panel.ts`). `fetchJson` unwraps envelopes and throws typed errors. Each panel is wrapped in an `ErrorBoundary` so a single failing panel doesn't crash the dashboard.
- **Security**: server bound to `127.0.0.1`. GitHub token read via `gh auth token`, held in memory only, never logged (pino redacts token/authorization/cookie paths), never returned to the client.

See `docs/superpowers/specs/` and `docs/superpowers/plans/` for the full design + implementation records.
