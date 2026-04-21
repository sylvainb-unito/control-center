# Journals Panel — Design

**Date:** 2026-04-20
**Status:** Approved
**Scope:** New panel `panels/journals/`, one new server module `server/src/lib/journals.ts`.

## Problem

Daily session journals (`/journal`) and weekly/monthly retros (`/retro`) accumulate in `~/.claude/journals/`. Reading them requires opening the directory in a terminal or editor and `cat`-ing files. There is no glance-and-read surface inside the dashboard, even though the dashboard's stated purpose is to put exactly this kind of information one click away.

## Goals

1. A panel that lists every journal across the three tiers (daily, weekly, monthly), grouped by tier into tabs.
2. Click any list row to render its markdown body inline (accordion).
3. Lazy-load body content per click — the initial list payload stays small even as journals accumulate over months.
4. No new actions yet — read-only. Editing/deleting/exporting can come later if you find yourself wanting them.

## Non-goals

- Editing journals inside the panel. They are written by `/journal` and `/retro`; this panel only reads.
- Deleting journals from the dashboard. The user can `rm` the file directly if they want.
- Search across journal bodies. Out of scope for v1; if it becomes useful, a simple grep endpoint can be added later.
- Open-in-external-editor button. Spec 2's row-click pattern (spawn external app) doesn't translate well — there's no canonical "open this markdown" action across editors.
- Notifications when a new journal lands. Manual refresh is fine.
- Multi-open accordion. Only one entry expanded at a time per tab.

## Window

**All time.** Journals are inherently historical; bounding them to the last N days defeats the purpose. The metadata-only initial response keeps the payload small even at hundreds of files. Bodies fetched on demand mean total payload scales with what you actually read, not what exists.

## Architecture

```
~/.claude/journals/
   ├─ daily/    YYYY-MM-DD[-N].md
   ├─ weekly/   YYYY-Www.md
   └─ monthly/  YYYY-MM.md

┌──────────────┐   GET /api/journals               ┌──────────────────────┐
│   UI (web)   │──────────────────────────────────▶  server/src/lib/      │
│              │   GET /api/journals/:tier/:id     │    journals.ts       │
│              │──────────────────────────────────▶  • glob each tier     │
└──────────────┘                                   │  • parse frontmatter │
                                                   │  • mtime cache (list)│
                                                   │  • lazy body read    │
                                                   └──────────────────────┘
```

**`server/src/lib/journals.ts`** — stateless module, holds an in-memory `Map<path, CacheEntry>` for list metadata. Exports:
- `listJournals(deps?): Promise<{ daily, weekly, monthly }>` — globs all three tiers, parses frontmatter, returns metadata only.
- `readJournalBody(tier, id, deps?): Promise<string>` — reads one file by `(tier, id)`, strips frontmatter, returns body.

**`panels/journals/`** — new panel workspace mirroring the existing 7-file shape.

**Markdown rendering** uses `react-markdown` (~25kb gzipped) + `remark-gfm` (~5kb) — standard React markdown stack, no eval, supports tables/checkboxes/fenced code. Renders inside the accordion's expanded body block.

**Frontmatter parsing** uses `gray-matter` (~10kb) on the server — battle-tested, no surprises.

## Data shapes

```ts
type Tier = 'daily' | 'weekly' | 'monthly';

export type JournalSummary = {
  id: string;              // filename without .md
  tier: Tier;
  date: string;            // primary date string from frontmatter, falls back to id
  repos: string[];         // from frontmatter `repos:`, may be empty
  sessions: number | null; // daily: from `session` field; weekly/monthly: from `sessions` count
  period?: string;         // weekly only — frontmatter `period:` (e.g. "2026-04-20 to 2026-04-26")
};

export type ListResponse = {
  daily: JournalSummary[];
  weekly: JournalSummary[];
  monthly: JournalSummary[];
};

export type BodyResponse = {
  body: string;
};
```

Each tier array is sorted most-recent first.

## API

### `GET /api/journals`

Returns `ListResponse` envelope-wrapped. Always 200.

### `GET /api/journals/:tier/:id`

Returns `{ body: string }` envelope-wrapped on success.

**Validation:**
- `:tier` must be `'daily'`, `'weekly'`, or `'monthly'`. Otherwise → 400 `BAD_REQUEST`.
- `:id` must match `^[A-Za-z0-9-]+$`. Otherwise → 400 `BAD_REQUEST`. This is defense in depth — the server resolves `:id` against the journals dir for the given tier, so traversal segments would already fail to match a real file. The pattern check just rejects them at the boundary.

**Errors:**

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | invalid `:tier` or `:id` |
| 404 | `JOURNAL_NOT_FOUND` | id valid but no matching file |
| 500 | `READ_FAILED` | filesystem error |

## Server flow (`listJournals`)

1. For each tier (`daily`, `weekly`, `monthly`):
   - Glob `<home>/.claude/journals/<tier>/*.md`. If the directory doesn't exist, return an empty array for that tier (no throw).
   - For each file, `stat` to get `(mtimeMs, size)`. Cache hit reuses the parsed `JournalSummary`. Otherwise read the file, parse frontmatter via `gray-matter`, build the summary, store in cache.
2. Sort each tier descending by `id` (which sorts correctly by date for all three tiers' filename conventions: `YYYY-MM-DD[-N]`, `YYYY-Www`, `YYYY-MM`).
3. Evict cache entries for files no longer in the glob result.
4. Return `{ daily, weekly, monthly }`.

**Frontmatter coercion:**
- `repos` non-array (legacy or malformed) → `[]`, log a warn with `{ tier, id }`.
- `sessions` missing on weekly/monthly → derived as `null`. (The weekly fixture in the wild uses `sessions: 1`; we treat it as count, not session number.)
- Daily `session` field is the session number-within-day (1, 2, 3) — same field used for `sessions` in the summary, since for a daily entry "session number" reads naturally as the count.

**Body read flow (`readJournalBody`):**
1. Validate tier + id (caller responsibility — handler does this before calling).
2. Resolve path: `<home>/.claude/journals/<tier>/<id>.md`.
3. Read the file with `fs.promises.readFile`. ENOENT → throw `JournalNotFoundError`. Other errors → throw `JournalReadError`.
4. Strip frontmatter via `gray-matter` and return the body string.

## UI

### Layout

```
╭─ Journals ─────────────────────────────── [refresh] ╮
│ ┌─DAILY─┐  WEEKLY   MONTHLY                         │ ← tab strip
│                                                     │
│ ▸ 2026-04-20 · control-center · 3 sessions          │
│ ▾ 2026-04-20-2 · control-center · 2 sessions        │ ← expanded
│ ┌─────────────────────────────────────────────────┐ │
│ │ ## Completed                                    │ │
│ │ - Configured `SessionEnd` hook…                 │ │
│ │ ## Key Decisions                                │ │
│ │ - Deferred cron automation…                     │ │
│ └─────────────────────────────────────────────────┘ │
│ ▸ 2026-04-20-3 · control-center · 1 session         │
│ ▸ 2026-04-19 · integrations · 2 sessions            │
╰─────────────────────────────────────────────────────╯
```

### Tab strip

Three buttons in a horizontal row. The active tab wears the neon-pink underline + bold treatment. State lives in `useState<Tier>('daily')` — defaults to daily on first load.

### Row layout

`{chevron} · {date} · {repos.join(', ')} · {sessions} session(s)`

- Chevron: `▸` collapsed, `▾` expanded.
- For weekly rows, `date` is replaced by `id` (`2026-W17`) and `period` is appended after the repos (`2026-W17 · control-center · 1 session · 2026-04-20 to 2026-04-26`).
- For monthly rows, `id` is `2026-04`; sessions count is shown the same way.
- Empty `repos` renders as `—`.
- `sessions === null` renders as `— sessions`.

### Accordion behaviour

**Single-open at a time per tab.** Clicking a different row collapses the previous one and opens the new. Tracked as `Record<Tier, string | null>` — switching tabs preserves the open entry per tier.

### Markdown body

Fetched via TanStack Query keyed by `[tier, id]` only when the row is expanded for the first time (`enabled: isOpen`). Cached by React Query thereafter — re-expanding the same entry doesn't refetch.

Rendered inside a `.body` block:
- Left border in `--cyan` to visually anchor the body to its row.
- Padded, smaller font, slightly dimmed prose color so the row metadata above stays primary.
- `react-markdown` configured with `remark-gfm` plugin (tables, task lists, autolinks).
- No `rehype-raw` — raw HTML in markdown is stripped, keeping the surface XSS-clean.

### States inside the accordion

- `loading…` while body fetch is in flight
- inline error line on failure (red, dismissable by collapsing the row)
- empty body → `(empty journal)`

### Refresh

Manual `refresh` button in the panel header (consistent with other panels) invalidates the list query. Body queries stay cached — only the list metadata refetches.

### No keyboard navigation

Click only for MVP. The accordion isn't a focus trap; rows are not tabbable. Add Enter/Space activation in a follow-up if you find yourself navigating by keyboard.

### Styling

Reuse existing theme vars:

| Token | Use |
|---|---|
| `--pink` / `--glow-pink` | active tab underline + glow |
| `--fg-dim` | inactive tab text, row metadata secondary text |
| `--cyan` | row date, body left border |
| `--fg` | body prose |
| `--danger` | error line |

No new CSS tokens.

## Caching

Module-level `Map<string, CacheEntry>` keyed by absolute file path:

```ts
type CacheEntry = {
  mtime: number;
  size: number;
  parsed: JournalSummary;
};
```

Same cache shape as Spec 2's `listRecentSessions`. Body reads are NOT server-cached — they are small (a few KB at most), single-shot, and React Query already caches them client-side.

`clearCache: true` option on `listJournals` for tests.

## Testing

**New: `server/src/lib/journals.test.ts`:**

- Glob + frontmatter parsing — fixture stream for one daily, one weekly, one monthly file → asserts the three returned arrays have the right `id`/`date`/`repos`/`sessions`/`period` fields.
- Sort order — most-recent first, multi-session same-day suffixes (`2026-04-20-2`, `2026-04-20-3`) ordered correctly within the date.
- Frontmatter missing fields — file with no `repos:` returns `repos: []`; missing `sessions:` returns `null`.
- Frontmatter with non-array `repos` (e.g. a string) → coerced to `[]`, warn logged.
- Body endpoint — strips frontmatter cleanly, returns body only.
- Body endpoint — empty body returns `''` (not error).
- mtime cache hit/miss/eviction (mirrors Spec 2's three-call pattern).
- Empty journals dir → empty arrays for all tiers, no throw.

**New: `panels/journals/api.test.ts`:**

- `GET /` returns envelope with all three tiers (mocked `listJournals`).
- `GET /:tier/:id` 200 with `{ body }` on success.
- `GET /:tier/:id` 404 `JOURNAL_NOT_FOUND` on miss.
- `GET /:tier/:id` 400 `BAD_REQUEST` on invalid tier (e.g. `'unknown'`).
- `GET /:tier/:id` 400 `BAD_REQUEST` on traversal-style id (e.g. `'../foo'`).

**No UI tests.** Same rationale as Worktrees and Claude Sessions panels — the view is thin glue over the API.

## Edge cases

- Multi-session daily files share a date prefix (`2026-04-20`, `2026-04-20-2`, `2026-04-20-3`). They sort as separate entries; descending `id` order puts the higher-numbered suffix first (`-3`, `-2`, base). This matches "most recent within the day".
- Markdown bodies with embedded HTML — `react-markdown` strips it (no `rehype-raw`).
- File-mtime updated mid-list — cache invalidates correctly via `(mtime, size)` comparison.
- Same `id` doesn't appear in two tiers (filename conventions are disjoint), so the per-tier identity is unambiguous.
- `~/.claude/journals/monthly/` is currently empty — the panel renders an empty Monthly tab gracefully.

## Migration

- No schema, no migrations, no persisted state.
- Three new dependencies: `react-markdown` and `remark-gfm` in the panel; `gray-matter` in the server. All narrow-purpose, no transitive bloat.
- Adds panel to `web/src/panels.ts` and `server/src/routes.ts` with `order: 50` (after the four existing panels).
- Adds `./lib/journals` to `server/package.json` exports (symmetric with `./lib/git`, `./lib/gh`, `./lib/sessions`).
- No changes to existing panels or modules.

## Files touched

**New:**
- `server/src/lib/journals.ts`
- `server/src/lib/journals.test.ts`
- `panels/journals/meta.ts`
- `panels/journals/types.ts`
- `panels/journals/api.ts`
- `panels/journals/api.test.ts`
- `panels/journals/ui.tsx`
- `panels/journals/ui.module.css`
- `panels/journals/package.json`
- `panels/journals/tsconfig.json`

**Changed:**
- `web/src/panels.ts` (register UI)
- `server/src/routes.ts` (register API)
- `server/package.json` (`gray-matter` dep + `./lib/journals` export)

## Open questions

None. Search, edit, delete, and external-editor actions are explicitly deferred (see Non-goals).
