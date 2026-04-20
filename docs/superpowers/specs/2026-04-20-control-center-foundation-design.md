# Control Center — Foundation (Spec 1)

**Date:** 2026-04-20
**Status:** Approved for planning
**Scope:** First of three specs. Delivers the app skeleton, retrowave theme, panel/plugin pattern, and three file/CLI-driven panels (worktrees, pull requests, tool shortcuts). Claude sessions/usage and AI news digest are separate specs.

## 1. Goals

Build a local web dashboard for solo personal use that:

1. Lists git worktrees across a fixed convention (`~/Workspace/*/.worktrees/`), with signals for safe pruning and a delete action.
2. Lists GitHub pull requests the user authored (open) and pull requests where the user is review-requested.
3. Provides configurable tool shortcuts (Asana, Stripe, Snowflake, dbt, Segment, Amplitude, etc.) with per-tool sub-links and logos.
4. Runs as a local background service on a fixed port (`127.0.0.1:7777`).
5. Uses a "Full Retrowave" visual style — grid floor, neon glow, saturated purple-to-pink gradient.
6. Is easy to extend with new panels: create a folder, add two registry lines.

## 2. Non-goals (Spec 1)

- Claude session listing / usage statistics (Spec 2).
- AI-assisted development news digest (Spec 3).
- In-UI editing of tool shortcuts (edit the JSON file for now).
- Multi-select / bulk worktree delete.
- Server-sent events or push updates.
- Authentication, multi-user, or external network exposure.
- CI pipeline (local-only project).

## 3. Tech stack

| Layer        | Choice                               | Notes                                            |
|--------------|--------------------------------------|--------------------------------------------------|
| Runtime      | Node 22 LTS                          | Pinned via `.nvmrc` and `engines`.               |
| Package mgr  | pnpm 9 (workspace)                   | Single repo, multiple packages.                  |
| Language     | TypeScript (strict)                  | `strict`, `noUncheckedIndexedAccess`.            |
| Web build    | Vite + React 18                      | SPA, no SSR.                                     |
| Server       | Hono                                 | Small, typed, minimal surface.                   |
| Data fetch   | TanStack Query (`@tanstack/react-query`) | Caching, refetch-on-focus, error states.    |
| Styling      | Plain CSS + CSS Modules              | No framework; retrowave needs raw control.       |
| Lint/format  | Biome                                | Single tool, one config.                         |
| Tests        | Vitest + React Testing Library       | Focused: libs + API routes, selected UI.         |
| Logger       | pino                                 | Structured JSON logs.                            |

Dependency due-diligence (to run at install time, not pre-committed):
- `npm audit` after install.
- Check GitHub advisories for `@tanstack/react-query` and `hono`.

## 4. Repository layout

```
control-center/
├── package.json                 # workspace root
├── pnpm-workspace.yaml
├── biome.json
├── tsconfig.base.json
├── .nvmrc                       # 22
├── .gitignore                   # includes .superpowers/
├── README.md                    # install + run instructions
├── config/
│   ├── shortcuts.json           # tool shortcuts definition
│   └── logos/                   # tool logo SVGs
├── panels/
│   ├── worktrees/
│   │   ├── ui.tsx
│   │   ├── api.ts
│   │   ├── meta.ts
│   │   ├── types.ts
│   │   └── ui.module.css
│   ├── pull-requests/            # same shape
│   └── shortcuts/                # same shape
├── web/
│   ├── index.html
│   ├── vite.config.ts
│   ├── public/fonts/             # self-hosted Orbitron, JetBrains Mono, VT323
│   └── src/
│       ├── main.tsx
│       ├── App.tsx               # grid layout, iterates registry
│       ├── panels.ts             # EXPLICIT panel registry (ui + meta)
│       ├── theme/
│       │   ├── tokens.css
│       │   ├── global.css
│       │   ├── panel.css
│       │   └── fx.css
│       └── lib/
│           ├── queryClient.ts    # TanStack Query setup
│           ├── fetchJson.ts      # envelope-aware fetch wrapper
│           └── ErrorBoundary.tsx # per-panel error boundary
├── server/
│   ├── src/
│   │   ├── main.ts               # Hono app, binds 127.0.0.1:7777
│   │   ├── routes.ts             # EXPLICIT route registry (api)
│   │   ├── envelope.ts           # { ok, data } / { ok:false, error } helpers
│   │   ├── logger.ts             # pino config + token/header scrubbers
│   │   └── lib/
│   │       ├── gh.ts             # `gh auth token` + GraphQL client
│   │       └── git.ts            # worktree list/remove + status helpers
│   └── tsconfig.json
├── shared/
│   └── panel.ts                  # PanelMeta, PanelUI, PanelAPI, Envelope types
└── scripts/
    ├── install-launchd.sh
    ├── uninstall-launchd.sh
    └── redeploy.sh
```

## 5. Extension pattern (panel contract)

Each panel is a self-contained folder under `panels/<id>/` exporting three things:

```ts
// shared/panel.ts
import type { FC } from 'react';
import type { Hono } from 'hono';

export type PanelMeta = {
  id: string;                      // unique id, matches folder name
  title: string;                   // display title
  icon?: string;                   // optional emoji / label
  order: number;                   // grid sort order
  defaultSize: 'sm' | 'md' | 'lg'; // grid column span: 4 | 6 | 8
};

export type PanelUI = FC;          // React component (reads its own data)
export type PanelAPI = Hono;       // Hono sub-app; mounted at /api/<id>

export type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
```

Registration is **explicit** in two files:

```ts
// web/src/panels.ts
import * as worktrees from '../../panels/worktrees/ui';
import * as worktreesMeta from '../../panels/worktrees/meta';
import * as prs from '../../panels/pull-requests/ui';
import * as prsMeta from '../../panels/pull-requests/meta';
import * as shortcuts from '../../panels/shortcuts/ui';
import * as shortcutsMeta from '../../panels/shortcuts/meta';

export const panels = [
  { meta: worktreesMeta.meta, UI: worktrees.UI },
  { meta: prsMeta.meta,       UI: prs.UI },
  { meta: shortcutsMeta.meta, UI: shortcuts.UI },
].sort((a, b) => a.meta.order - b.meta.order);
```

```ts
// server/src/routes.ts
import { Hono } from 'hono';
import { api as worktreesApi } from '../../panels/worktrees/api';
import { api as prsApi }       from '../../panels/pull-requests/api';
import { api as shortcutsApi } from '../../panels/shortcuts/api';

export function registerRoutes(app: Hono) {
  app.route('/api/worktrees',     worktreesApi);
  app.route('/api/pull-requests', prsApi);
  app.route('/api/shortcuts',     shortcutsApi);
}
```

Adding a panel = new folder + two registry lines + two imports. Load order is explicit; no build-time magic.

## 6. Panel specs

### 6.1 Worktrees

**Endpoints**

- `GET /api/worktrees` → `Envelope<{ repos: Repo[] }>`

  ```ts
  type Repo = { name: string; path: string; worktrees: Worktree[] };
  type Worktree = {
    path: string;
    branch: string;
    head: string;                         // short SHA
    dirty: boolean;                       // has uncommitted changes
    ahead: number;                        // commits ahead of upstream
    behind: number;
    lastCommitAt: string;                 // ISO 8601
    mergedToMain: boolean;
    ageDays: number;                      // derived convenience
  };
  ```

- `DELETE /api/worktrees` — body `{ path: string; force?: boolean }` → `Envelope<{ removed: string }>`.
  Runs `git worktree remove [--force] <path>`. Without `force`, returns `{ code: 'DIRTY_WORKTREE' }` if the tree has uncommitted changes.

**Discovery algorithm** (server, on each GET):

1. Glob `~/Workspace/*/.worktrees/*` (directories only).
2. Group by parent repo (the directory containing `.worktrees/`).
3. For each worktree path:
   - `git -C <path> rev-parse --abbrev-ref HEAD` → branch name.
   - `git -C <path> rev-parse --short HEAD` → head sha.
   - `git -C <path> status --porcelain` → dirty if non-empty.
   - `git -C <path> rev-list --left-right --count @{upstream}...HEAD` → ahead/behind (tolerates no upstream → 0/0).
   - `git -C <path> log -1 --format=%cI` → lastCommitAt ISO.
4. For each parent repo once:
   - `git -C <repo> branch --merged main --format=%(refname:short)` → set of merged branches.
   - `mergedToMain = branch ∈ mergedSet`.
5. Missing `main` branch (some repos use `master`): fall back to `master`; if neither, `mergedToMain = false`.

**UI**

- Groups by repo name, collapsible (expanded by default).
- Each worktree row: branch name, short sha, age, badges (dirty / ahead / behind / merged), delete button.
- Badge colors: `merged` = green, `dirty` = yellow, `ahead/behind` = cyan/pink.
- Delete button → confirmation modal: "Remove `<path>`?" with a warning if dirty ("Uncommitted changes will be lost — use Force delete"). "Force delete" is a separate button revealed when `dirty === true`.
- After successful delete: optimistic removal from the list + refetch.

### 6.2 Pull Requests

**Endpoint**

- `GET /api/pull-requests` → `Envelope<{ authored: PR[]; reviewRequested: PR[] }>`

  ```ts
  type PR = {
    number: number;
    title: string;
    url: string;
    repo: string;                          // "owner/name"
    createdAt: string;
    updatedAt: string;
    isDraft: boolean;
    reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
    checks: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'NEUTRAL' | null;
  };
  ```

**Token handling**

- On first use, spawn `gh auth token` via `execFile` (no shell). Parse stdout, trim.
- Hold token in a closure in `server/src/lib/gh.ts`. Never log, never send to client, never write to disk.
- Bind listener to `127.0.0.1` only — no external exposure.
- On any GraphQL response with HTTP 401, invalidate cached token and retry once.
- If `gh auth token` fails: return envelope error `{ code: 'GH_AUTH_MISSING', message: 'Run `gh auth login` first.' }`.

**GraphQL query** (single round-trip per refresh):

```graphql
query DashboardPRs {
  viewer {
    login
    pullRequests(first: 50, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        url
        isDraft
        createdAt
        updatedAt
        reviewDecision
        repository { nameWithOwner }
        commits(last: 1) {
          nodes { commit { statusCheckRollup { state } } }
        }
      }
    }
  }
  search(query: "is:pr is:open review-requested:@me", type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number title url isDraft createdAt updatedAt reviewDecision
        repository { nameWithOwner }
        commits(last: 1) {
          nodes { commit { statusCheckRollup { state } } }
        }
      }
    }
  }
}
```

**UI**

- Two sections: "Yours" (authored) and "To Review" (review-requested).
- Each row: `repo/#num title` (clickable to `url`), badges for draft / reviewDecision / checks.
- Empty state per section: "No open PRs" in `--fg-dim`.
- Badge colors: approved = green, changes-requested = danger, checks-failing = danger, pending = yellow.

### 6.3 Shortcuts

**Endpoint**

- `GET /api/shortcuts` → `Envelope<Shortcut[]>`

  ```ts
  type Shortcut = {
    id: string;
    label: string;
    logo?: string;                         // filename under config/logos/
    links: Array<{ label: string; url: string }>;
  };
  ```

Reads `config/shortcuts.json`. No writes.

**`config/shortcuts.json` defaults (shipped):**

```json
[
  { "id": "asana",     "label": "Asana",     "logo": "asana.svg",
    "links": [
      { "label": "My tasks", "url": "https://app.asana.com/0/me" },
      { "label": "Inbox",    "url": "https://app.asana.com/0/inbox" }
    ] },
  { "id": "stripe",    "label": "Stripe",    "logo": "stripe.svg",
    "links": [{ "label": "Dashboard", "url": "https://dashboard.stripe.com" }] },
  { "id": "snowflake", "label": "Snowflake", "logo": "snowflake.svg",
    "links": [{ "label": "Worksheet", "url": "https://app.snowflake.com" }] },
  { "id": "dbt",       "label": "dbt",       "logo": "dbt.svg",
    "links": [{ "label": "Cloud", "url": "https://cloud.getdbt.com" }] },
  { "id": "segment",   "label": "Segment",   "logo": "segment.svg",
    "links": [{ "label": "App", "url": "https://app.segment.com" }] },
  { "id": "amplitude", "label": "Amplitude", "logo": "amplitude.svg",
    "links": [{ "label": "App", "url": "https://app.amplitude.com" }] }
]
```

**UI**

- Grid of logo tiles (one per shortcut). Tile shows logo + label.
- Click tile with a single link → opens that URL in a new tab (`target="_blank" rel="noopener noreferrer"`).
- Click tile with multiple links → opens a popover anchored to the tile listing each link; click-outside or Esc closes it.
- Missing logo file → render a neon-outlined placeholder square containing the first two letters of the label in Orbitron.

## 7. Data flow & refresh

- Each panel owns its queries via TanStack Query keys: `['worktrees']`, `['pull-requests']`, `['shortcuts']`.
- `QueryClient` configured with:
  - `refetchOnWindowFocus: true`
  - `staleTime: 10_000` (prevents hammering on rapid tab-switches)
  - `retry: 1`
  - `gcTime: 300_000`
- Each panel exposes a refresh button calling `queryClient.invalidateQueries({ queryKey: [id] })`.
- Mutations (only `DELETE /api/worktrees` in Spec 1) invalidate `['worktrees']` on success.

## 8. Error handling

**Server:**

- Every handler returns the `Envelope<T>` shape via helpers `ok(data)` / `fail(code, message)`.
- Subprocess failures (`execFile`) are caught and mapped to `{ code, message }`. Stderr is truncated to 200 chars before being sent.
- A global Hono `onError` handler maps uncaught exceptions to `{ code: 'INTERNAL', message }` and logs the full stack.
- Token, auth headers, and cookies are scrubbed from pino log output via a custom serializer.

**Client:**

- `fetchJson` throws on HTTP !== 2xx or `envelope.ok === false`, surfacing `{ code, message }`.
- Each panel is wrapped in an `ErrorBoundary` that renders a red-pink panel error state with a "Retry" button (invalidates the panel's query). A panel crash does not crash the dashboard.
- Common error UX: `GH_AUTH_MISSING` → shows "Run `gh auth login` and retry." with a retry button.

## 9. Theming

**Direction:** Full Retrowave (Option A from brainstorming) — grid floor, neon glow, saturated purple-to-pink gradient.

**Files (`web/src/theme/`):**

- `tokens.css` — CSS variables for colors, shadows, radii, spacing.
- `global.css` — resets, `<body>` background (gradient + grid floor + sun), typography defaults.
- `panel.css` — shared panel chrome (`.panel`, `.panel-header`, `.panel-body`, `.panel-row`).
- `fx.css` — effect utilities (`.neon-text`, `.scanlines`, `.glow-border`, `.badge-success|warn|danger`).

**Palette (defined in `tokens.css`):**

```css
:root {
  --bg-deep:      #0b0221;
  --bg-mid:       #1a0540;
  --bg-hot:       #3d0a5c;
  --sun:          #ff006e;
  --pink:         #ff71ce;     /* primary accent */
  --cyan:         #01cdfe;     /* secondary accent */
  --green:        #05ffa1;     /* success / safe */
  --yellow:       #fffb96;     /* warnings */
  --fg:           #f5e6ff;     /* body text */
  --fg-dim:       #b29fc7;     /* secondary text */
  --danger:       #ff2d6f;
  --panel-bg:     rgba(11, 2, 33, 0.72);
  --panel-border: var(--pink);
  --glow-pink:    0 0 10px #ff71ce, 0 0 22px rgba(255,113,206,0.5);
  --glow-cyan:    0 0 10px #01cdfe, 0 0 22px rgba(1,205,254,0.5);
}
```

**Typography (self-hosted in `web/public/fonts/`, no CDN at runtime):**

- Headings: Orbitron (letter-spaced, geometric).
- Body/data: JetBrains Mono (readable for paths, branches, PR numbers).
- Badges/accent numerals: VT323 (chunky retro-terminal).

**Body background:** purple gradient (`--bg-deep` → `--bg-hot` → `--sun`), grid floor (1px pink + cyan repeating lines, masked to the lower half via `linear-gradient` mask), static sun (radial-gradient circle with horizontal-stripe mask). No default animations.

**Panel chrome:** `background: var(--panel-bg); backdrop-filter: blur(6px); border: 2px solid var(--panel-border); box-shadow: var(--glow-pink), inset 0 0 20px rgba(1, 205, 254, 0.1);`. Header uppercase Orbitron with `text-shadow: var(--glow-pink)`. Rows separated by 1px dashed pink; hover row brightens and adds cyan underline.

**Layout:** CSS Grid at app root — `grid-template-columns: repeat(12, 1fr); gap: 20px; padding: 28px`. `defaultSize` maps to `sm=span 4 / md=span 6 / lg=span 8`. Under 900px, collapse to single column, preserving `meta.order`.

**Accessibility:**

- `--fg` on `--panel-bg` meets WCAG AA (verified via contrast calculator at spec-write time).
- `@media (prefers-reduced-motion: reduce)` disables pulse animations; static glow is retained.
- All interactive elements show a 2px cyan focus outline.

## 10. Run model & deployment

**Dev:**

- `pnpm dev` concurrently runs:
  - Vite dev server on `:5173`.
  - Hono dev server on `:7778` (ts-node-dev or tsx).
- Vite proxies `/api/*` → `http://127.0.0.1:7778`.

**Prod (daemon):**

- `pnpm build`:
  - `web`: Vite builds static assets into `web/dist/`.
  - `server`: tsc builds into `server/dist/`.
- `server/src/main.ts`:
  - Serves `web/dist/` static files.
  - Mounts `/api/*` via `registerRoutes(app)`.
  - Binds `127.0.0.1:7777` (configurable via `PORT` env).
- `scripts/install-launchd.sh` writes `~/Library/LaunchAgents/io.unito.control-center.plist`:
  - `ProgramArguments`: `["/usr/local/bin/node", "<repo>/server/dist/main.js"]` (node path resolved at install time).
  - `EnvironmentVariables`: `PATH` including `/usr/local/bin` and `/opt/homebrew/bin` (so `gh` is found).
  - `RunAtLoad: true`, `KeepAlive: true`.
  - `StandardOutPath` / `StandardErrorPath`: `~/Library/Logs/control-center.log`.
  - Runs `launchctl load` + prints `open http://localhost:7777`.
- `scripts/uninstall-launchd.sh`: `launchctl unload` + removes plist; preserves logs.
- `scripts/redeploy.sh`: `pnpm install && pnpm build && launchctl kickstart -k gui/$(id -u)/io.unito.control-center`.

**Health:** `GET /api/health` → `{ ok: true, data: { uptime: number, version: string, startedAt: string } }`. `version` is injected at build time from the root `package.json`'s `version` field via a Vite/tsc define. Used by a small dashboard footer (version + uptime) and for debugging.

## 11. Testing

- **Vitest** configured for both `server/` and `web/`.
- **Server unit tests** (highest value):
  - `lib/gh.ts`: mock `execFile`, assert token is read from `gh auth token`, never logged, refreshed on 401.
  - `lib/git.ts`: mock `execFile`, assert correct arg lists (including `--force`) and that dirty trees surface `DIRTY_WORKTREE`.
  - `envelope.ts`: trivial but guards the response shape.
- **Panel API tests**:
  - One test file per panel. Use Hono's `app.request(...)` with mocked libs. Assert envelope shape for happy path and each defined error code.
- **Web component tests** (narrow):
  - Worktree delete confirmation modal (force path, non-force path).
  - `ErrorBoundary` renders retry UI on thrown error.
- **No E2E / Playwright.**
- `pnpm test` runs both workspaces. Optional `pre-push` husky hook.

## 12. Observability

- `pino` structured JSON logs in the server, piped to `~/Library/Logs/control-center.log` via launchd.
- Log levels: `info` (requests, lifecycle), `warn` (recoverable — e.g., empty `gh` output), `error` (handler failures).
- Log fields: `time`, `level`, `panel`, `route`, `durationMs`, `ok`, `errorCode`.
- Custom serializer strips `Authorization`, `Cookie`, and any field matching `/token/i` from logged objects.
- Client: errors caught by `ErrorBoundary` are `console.error`-logged with panel id; no remote reporting.

## 13. Security

- Bound to `127.0.0.1` only. No external surface.
- GitHub token handled server-side only; never returned to client, never logged.
- `config/shortcuts.json` URLs are treated as user-trusted; `target="_blank" rel="noopener noreferrer"` on all opens.
- No secrets stored in the repo. Logos in `config/logos/` are static SVGs, bundled at build time.
- Dependency due-diligence: `npm audit` post-install; monitor `@tanstack/react-query` and `hono` advisories.

## 14. Open questions / decisions deferred

None for Spec 1. Claude sessions (Spec 2) and AI news (Spec 3) have their own brainstorming sessions pending.

## 15. Acceptance criteria

1. `pnpm install && pnpm build && scripts/install-launchd.sh` on a clean macOS machine leaves a running service on `http://localhost:7777`.
2. Dashboard loads at that URL showing three panels (worktrees, pull requests, shortcuts) in retrowave style (Option A — full grid floor + neon).
3. Worktrees panel lists every directory under `~/Workspace/*/.worktrees/` with branch / dirty / merged signals. Delete works (including `--force`) and the list refreshes.
4. Pull requests panel shows authored and review-requested PRs for the authenticated `gh` user, with status badges.
5. Shortcuts panel renders six default tiles; editing `config/shortcuts.json` and refreshing the page reflects changes.
6. Refreshing the browser tab after changing focus triggers a refetch (up to `staleTime`).
7. Killing the server via Activity Monitor causes launchd to restart it within seconds.
8. `pnpm test` runs green.
