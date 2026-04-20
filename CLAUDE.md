# Control Center — Claude Instructions

Local dev dashboard. Solo user. Bound to `127.0.0.1` only. Retrowave theme.

See `README.md` for install/run and `docs/superpowers/specs/` for the full design.

## Stack (locked — don't re-litigate)

Vite + React 18 + Hono + TypeScript strict, pnpm workspace, Biome (lint/format), Vitest, TanStack Query, pino logs, plain CSS. No Tailwind, no CSS-in-JS.

## Workspace layout

- `web/` — Vite React app
- `server/` — Hono server (runs under `tsx` in dev and prod, no compile step)
- `shared/` — shared types (notably `Envelope<T>`)
- `panels/<id>/` — co-located panels: `meta.ts`, `types.ts`, `api.ts`, `ui.tsx`, `ui.module.css`
- `config/` — `shortcuts.json` + `logos/`
- `scripts/` — launchd install / redeploy / uninstall

Panels are wired through **two explicit registries** — never auto-discover:

- `web/src/panels.ts` (UI)
- `server/src/routes.ts` (API)

## Commands

```bash
pnpm dev         # vite (5173) + hono (7778) via concurrently
pnpm -r test     # run all workspace tests (vitest)
pnpm check       # biome lint + format check
pnpm fix         # biome autofix — run before committing
pnpm build       # server noop + web build → web/dist
```

Prod daemon listens on **7777** (launchd), dev server on **7778**, Vite on **5173**.

## Conventions

- **Envelope pattern.** Every API response is `Envelope<T>` from `shared/panel.ts`. Server wraps via `envelope.ts`; client unwraps via `fetchJson`. Don't return raw JSON from handlers.
- **Panel errors are isolated.** Each panel is wrapped in an `ErrorBoundary` — one panel crashing must never take down the dashboard.
- **Ordering.** Panel load order is `meta.order` ascending.
- **CSS modules** (`*.module.css`) for panel styles. Global theme lives in `web/src/theme/`.
- **No new dependencies** without a clear reason — the stack is intentionally small.

## Security rules (hard)

- Server must stay bound to `127.0.0.1`. Never expose to `0.0.0.0`.
- GitHub token comes from `gh auth token`, held in memory only. Never log it, never return it to the client. pino redacts `token` / `authorization` / `cookie` paths — keep it that way.
- Never echo secrets into responses or logs even when debugging.

## Before committing

1. `pnpm fix` (biome autofix — avoids a CI lint-fix commit)
2. `pnpm -r test`
3. `pnpm check`

PRs are always draft (`gh pr create --draft`). See `~/.claude/CLAUDE.md` for global PR/commit rules.

## Adding a panel

Mirror `panels/worktrees/` (richest reference). Steps:

1. Scaffold `panels/<id>/` with `meta.ts`, `types.ts`, `api.ts`, `ui.tsx`, `ui.module.css`, `package.json`, `tsconfig.json`.
2. Register in `web/src/panels.ts` and `server/src/routes.ts`.
3. `pnpm install && pnpm -r test`.
