# Claude Sessions Panel — Design

**Date:** 2026-04-20
**Status:** Approved
**Scope:** New panel `panels/claude-sessions/`, one new server module `server/src/lib/sessions.ts`, one config file.

## Problem

Claude Code writes every session to `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. There is no dashboard view of that activity — you can't glance at what you ran today, you can't easily resume a previous session without remembering its ID, and you have no sense of how much you're burning through tokens across projects.

## Goals

1. A panel that lists recent Claude Code sessions grouped by day, with enough headline info per row to identify a session at a glance.
2. A live/closed badge per row so you know whether a session is still open in another terminal.
3. A click action that opens a Ghostty tab running `claude --resume <sessionId>` inside the session's original `cwd` — but only for closed sessions, to avoid two processes writing the same JSONL.
4. A bonus stats strip summarising the window (sessions, duration, messages, tokens, estimated cost).

## Non-goals

- Full-text search across session content. If you want to reread a session, use Claude Code's own `/resume` flow or open the JSONL.
- Per-session drill-in / inline expansion / modal — rows are read-only info + a click action.
- Weekly / monthly retros — those are Spec 4 (journals).
- Focusing an existing Ghostty tab via AppleScript — brittle and deferred. Live rows are disabled with a tooltip telling the user to switch manually.
- Remote session ingestion, multi-user, or auth — single user, localhost only, same as the rest of the dashboard.
- Persistent cache. In-memory cache keyed by `(path, mtime, size)` is enough; the daemon lives for days under launchd.

## Scope

**Window:** last **10 office days** (Mon-Fri). Cutoff = start-of-day (local tz) 10 weekdays ago. Sessions whose file mtime is ≥ cutoff are included, regardless of whether the activity itself fell on a weekend within the resulting calendar range.

**Data source:** glob `<home>/.claude/projects/*/*.jsonl`. Sessions are read-only; no writes to that directory.

## Architecture

```
~/.claude/projects/                     ← data source, read-only
   └─ <encoded-cwd>/
        └─ <sessionId>.jsonl

┌──────────────┐   GET /api/claude-sessions             ┌──────────────────────┐
│   UI (web)   │────────────────────────────────────────▶  server/src/lib/      │
│              │                                        │    sessions.ts       │
│              │   POST /api/claude-sessions/open       │   • scan dirs        │
│              │────────────────────────────────────────▶  • stream-parse jsonl│
└──────────────┘        spawn ghostty (when !isLive)    │   • cache (path+mtime)│
                                                        └──────────────────────┘
```

- **`server/src/lib/sessions.ts`** — stateless module, holds an in-memory cache. Exports `listRecentSessions({ officeDays, now?, pricing?, home? })` and `openSessionInGhostty(sessionId, cwd)`. Cache is a module-level `Map`; no singleton pattern required (server process is the only consumer).
- **`panels/claude-sessions/`** — the panel workspace. Same 7-file layout as existing panels.
- **`config/model-pricing.json`** — published per-model rates. Human-editable; reloaded on each server boot (no hot reload needed).

## State classification per session

Derived in `sessions.ts`, read by UI:

| Field | Meaning |
|---|---|
| `isLive: boolean` | `Date.now() - mtime < 120_000` — the file has been written in the last two minutes |

That's the only classification. Everything else is a straight read from JSONL.

## Per-session aggregates

```ts
export type SessionSummary = {
  sessionId: string;              // UUID from filename (also matches line records)
  project: string;                // basename(cwd)
  cwd: string;                    // full cwd from first parseable line
  gitBranch: string | null;       // first recorded gitBranch; null if never written
  startedAt: string;              // ISO — timestamp of first parseable line with a timestamp
  lastActivityAt: string;         // ISO — timestamp of last parseable line with a timestamp
  durationMs: number;             // lastActivityAt - startedAt
  messageCount: number;           // count of lines where type === 'user' || type === 'assistant'
  primaryModel: string | null;    // model ID with the highest assistant-output token accumulation
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  estCostUsd: number;             // sum of (tokensByModel × pricing); 0 if model unknown
  pricingMissing: boolean;        // true if primaryModel has no rate in config
  isLive: boolean;
};
```

**Primary-model selection:** sum output tokens by model-id across all assistant lines in the session; pick the model with the largest sum. Ties broken by most-recent appearance. Single-model sessions always pick that model.

**`estCostUsd` calculation:** for each `(model, tokenBucket, count)` triple seen in the session, look up the rate in `config/model-pricing.json`. Missing rate contributes zero to the row's total and sets `pricingMissing: true` on that row. The UI shows "—" with a tooltip when `pricingMissing` is true.

## Caching

Module-level `Map<string, CacheEntry>` where:

```ts
type CacheEntry = {
  mtime: number;     // stat.mtimeMs
  size: number;      // stat.size
  parsed: SessionSummary;
};
```

On each `listRecentSessions` call:
1. Glob files, filter by mtime cutoff.
2. For each survivor, `stat` the file. If the cached entry's `mtime` and `size` match, reuse `parsed`. Otherwise re-parse.
3. Re-parse streams the JSONL line by line with Node's `readline` (no full-buffer load). Lines that fail `JSON.parse` are counted, logged (first offense per file per run), and skipped — we do NOT fail the aggregate on a single bad line. This matters because the currently-live session's file is being appended to while we read, so the last line is sometimes truncated.

**Cache eviction:** entries whose file is no longer in the glob result on a given call get deleted from the Map. Keeps memory bounded as the 10-office-day window slides forward.

## Office-day cutoff math

```ts
function officeDayCutoff(now: Date, officeDays: number): Date {
  // Cutoff = start-of-day of the weekday exactly `officeDays` weekdays before `now`.
  // The window is [cutoff, now], which includes `now`'s date.
  const d = new Date(now);
  let remaining = officeDays;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay(); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) remaining--;
  }
  d.setHours(0, 0, 0, 0);
  return d;
}
```

A `now` injectable for tests. DST edge cases are implicit in `setHours(0, 0, 0, 0)` — we tolerate a one-hour skew at the DST transition, which is acceptable for a 10-day window.

**Interpretation note:** with `officeDays = 10`, the window contains exactly 10 full weekdays that are strictly before `now`'s date, plus `now`'s own date (whatever day of week it is). So you always see ~11 weekdays' worth of activity when `now` itself falls on a weekday. This is intentional: the exact boundary is less important than the property "roughly two working weeks of recent activity, weekends don't shift the window."

## API

### `GET /api/claude-sessions`

Response (envelope-wrapped):
```ts
{
  sessions: SessionSummary[];      // sorted by startedAt desc
  stats: {
    count: number;
    durationMs: number;
    messageCount: number;
    tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
    estCostUsd: number;
    pricingMissing: boolean;       // true if ANY row had pricingMissing
  };
  window: {
    officeDays: 10;
    cutoffAt: string;              // ISO
  };
}
```

### `POST /api/claude-sessions/open`

Body: `{ sessionId: string; cwd: string }`.

Server-side validation (safety net, not a trust boundary — the server is bound to 127.0.0.1 and the user controls the client):
1. Resolve the current list of cached sessions via `listRecentSessions`.
2. Find a session whose `sessionId` AND `cwd` match the body. If none → `404 SESSION_NOT_FOUND`.
3. If the match has `isLive: true` → `409 SESSION_LIVE` (prevents two processes writing the same JSONL).
4. Spawn Ghostty with the resume command. On success → `200 { opened: true }`. On spawn failure → `500 SPAWN_FAILED` with the truncated error.

Spawn invocation:

```bash
open -na Ghostty --args \
  --working-directory=<cwd> \
  -e claude --resume <sessionId>
```

Flag semantics: `--working-directory` sets Ghostty's initial cwd, `-e` asks it to run the given command on start. These match Ghostty's current CLI contract on macOS. If a future Ghostty version changes this, the spawn helper is a single function and easy to update.

The spawn is fire-and-forget — the server does not wait for Ghostty to finish. We only care that `open` returned zero and Ghostty started.

### Error codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | missing `sessionId` or `cwd` on POST |
| 404 | `SESSION_NOT_FOUND` | POST body doesn't match a cached session |
| 409 | `SESSION_LIVE` | match is live; UI shouldn't issue this but server gates it |
| 500 | `SPAWN_FAILED` | Ghostty spawn returned non-zero |

## UI

### Layout

```
╭─ Claude sessions ─────────────────────────────── [refresh] ╮
│ Last 10 office days · 23 sessions · 14h 22m · 1,843 msgs   │ ← stats strip
│ 412k in / 89k out / 2.1M cache  ·  ~$8.74 est              │
│                                                            │
│ Today                                                      │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ ● LIVE  control-center · main · opus-4-7 · 1h 12m · 89│   │ ← disabled row
│ │  └ (tooltip) session already open — switch manually   │   │
│ ├──────────────────────────────────────────────────────┤   │
│ │ integrations · feat/x · sonnet-4-6 · 42m · 31 msgs    │   │ ← clickable
│ ├──────────────────────────────────────────────────────┤   │
│ │ console · main · opus-4-7 · 7m · 8 msgs               │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│ Yesterday                                                  │
│ ...                                                        │
╰────────────────────────────────────────────────────────────╯
```

### Day-group headers

Derived client-side from each row's `startedAt`:
- Today / Yesterday (based on local date)
- For dates within the last 6 days: weekday name ("Monday")
- Older: `YYYY-MM-DD`

Sessions that span midnight stay in their `startedAt` group.

### Row anatomy

Left-to-right: optional live dot · project · branch (or "—" if null) · primary model (or "—") · duration (humanized — `1h 12m`, `42m`, `7m`, `<1m`) · message count.

### Click behaviour

- **Live row:** disabled cursor, `title` = `"session open — switch to it manually (cmd-\`)"`, no mutation fired.
- **Non-live row:** fires `POST /api/claude-sessions/open`. On 200 the row briefly flashes a neon border. On error, an inline error line appears under the row for a few seconds.

### Refresh

- TanStack Query with `staleTime: 30_000`.
- `refetchInterval` is a function: returns `30_000` only if the most recent response contained at least one `isLive: true` row, otherwise `false`.
- Manual `refresh` button in the panel header, same pattern as Spec 1.

### Styling

Reuse existing theme vars:

| Token | Use |
|---|---|
| `--success` / `--glow-pink` pulse | live dot |
| `--fg-dim` | inactive day-group headers, stats strip secondary text |
| `--cyan` | row project names (matches existing repo headers in Worktrees panel) |
| `--pink` | stats strip emphasis (tokens total, $ est) |
| `--yellow` | `pricingMissing` indicator |

No new CSS tokens.

## Pricing config

`config/model-pricing.json` shape:

```json
{
  "claude-opus-4-7": {
    "inputPerMtok": 15.0,
    "outputPerMtok": 75.0,
    "cacheReadPerMtok": 1.5,
    "cacheCreationPerMtok": 18.75
  },
  "claude-sonnet-4-6": {
    "inputPerMtok": 3.0,
    "outputPerMtok": 15.0,
    "cacheReadPerMtok": 0.3,
    "cacheCreationPerMtok": 3.75
  },
  "claude-haiku-4-5-20251001": {
    "inputPerMtok": 1.0,
    "outputPerMtok": 5.0,
    "cacheReadPerMtok": 0.1,
    "cacheCreationPerMtok": 1.25
  }
}
```

Rate values above are illustrative, not authoritative — verify against the current Anthropic price list at config creation time. Implementer should populate the three models with the rates in effect on 2026-04-20 and note the date in a sibling comment or filename suffix.

Rates are per million tokens. User refreshes values manually when Anthropic changes pricing. Missing model → `pricingMissing: true` on the row, no hard error.

## Testing

**New: `server/src/lib/sessions.test.ts`:**
- Cutoff math: Monday, mid-week, Sunday, DST-transition day
- Parser fixture: tiny JSONL with 2 user + 2 assistant lines + 1 attachment, asserts startedAt/lastActivityAt/duration/messageCount/tokens/primaryModel
- Primary-model tie-break: identical output tokens across two models → most recent wins
- Trailing-incomplete-line tolerance: last line unparseable JSON → aggregate still returns with remaining data
- Cache hit: `(mtime, size)` match → no re-parse (injected `parseSessionFile` spy should not be called)
- Cache miss: mtime change → re-parse
- Empty projects dir → empty array, no throw
- `isLive: true` for file with mtime within 120 s; false for older

**New: `panels/claude-sessions/api.test.ts`:**
- `GET` returns envelope with sessions + stats + window (mocked `listRecentSessions`)
- `POST /open` with unknown sessionId → 404 `SESSION_NOT_FOUND`
- `POST /open` with live match → 409 `SESSION_LIVE`
- `POST /open` with valid closed match → 200 `{ opened: true }` and spawn helper called with exact args
- `POST /open` with missing body fields → 400 `BAD_REQUEST`

**No UI tests.** Same rationale as Spec 1's Worktrees panel — the view is thin glue over the API.

## Edge cases

- Two sessions in the same project on the same day → both rows show, most recent first.
- Session spans midnight → groups by `startedAt` local date (stays in one group).
- Session with zero assistant messages (only user + attachments) → `primaryModel: null`, `estCostUsd: 0`, no `pricingMissing` flag.
- Single session with multiple models (user switched mid-run) → `primaryModel` reflects largest-output model; token sums are totals across models.
- `~/.claude/projects/` doesn't exist → empty array, 200 OK.
- Glob permission denied on a file → warn log, skip that file, continue.
- JSONL parse fails on every line → warn log, skip session entirely (not returned).
- Ghostty not installed → `open -na Ghostty` fails → `500 SPAWN_FAILED` with underlying stderr (truncated).

## Migration

- No schema, no migrations, no persisted state.
- New panel is additive; registering it in `web/src/panels.ts` and `server/src/routes.ts` is the only wiring change.
- `config/model-pricing.json` ships with defaults for current Claude models. User can edit and reboot the server to pick up new rates.

## Files touched

**New:**
- `server/src/lib/sessions.ts`
- `server/src/lib/sessions.test.ts`
- `panels/claude-sessions/meta.ts`
- `panels/claude-sessions/types.ts`
- `panels/claude-sessions/api.ts`
- `panels/claude-sessions/api.test.ts`
- `panels/claude-sessions/ui.tsx`
- `panels/claude-sessions/ui.module.css`
- `panels/claude-sessions/package.json`
- `panels/claude-sessions/tsconfig.json`
- `config/model-pricing.json`

**Changed:**
- `web/src/panels.ts` (register UI)
- `server/src/routes.ts` (register API)

## Open questions

None. AppleScript-based tab focusing and drill-in views are explicitly deferred (see Non-goals).
