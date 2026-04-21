# Spec 3 — AI News Digest Panel

**Date:** 2026-04-21
**Status:** Approved for planning
**Scope:** Third of the roadmap specs. Delivers a daily LLM-driven digest of AI-assisted-development news, surfaced in a two-tab panel (Digest / Starred).

## 1. Goals

- A glanceable daily view of what shipped across AI-assisted-dev tools, models, protocols, research, and community posts.
- Zero-friction reading: open the dashboard in the morning, see a 1-paragraph exec summary and 10 items.
- Star items you want to revisit; starred items persist beyond the 7-day digest retention window.
- Reuse the existing braindump infra (`defaultRunClaude` → `claude -p`) — no new SDK, no new auth.

## 2. Non-goals

- In-UI editing of items (titles, summaries).
- Comments / notes attached to items.
- Push notifications or sound alerts.
- Cross-device sync (solo local dashboard).
- Full-text search across past digests (revisit if the corpus grows).
- Multiple digests per day by topic (one digest, five categories).

## 3. User flows

### 3.1 Morning read

1. User opens http://localhost:7777 around 8am.
2. AI News panel's Digest tab shows today's exec summary + 10 items.
3. User skims the summary, clicks 1-2 items open in new tabs.
4. User stars one item they want to revisit later; star toggles optimistically.

### 3.2 Before-7am peek

1. User opens dashboard at 6:30am; digest hasn't run yet.
2. Digest tab shows empty state: "No digest yet today — running shortly".
3. No refresh button action needed; the 7am tick will fire automatically.

### 3.3 Manual refresh after a big release

1. User hears about a Claude model drop at 10am.
2. Clicks Refresh in the panel header.
3. Status strip flips to "Running…"; UI polls `/today` every 30s.
4. New digest replaces today's file; list re-renders.

### 3.4 Review starred

1. User switches to Starred tab.
2. Sees flat list of starred items across all surviving digest files, grouped by digest date (newest first).
3. Clicks a star to unstar → row fades out; underlying digest file updates.

## 4. Architecture

Panel follows the standard co-located layout and registers with the two explicit registries.

```
panels/ai-news/
  meta.ts          # id='ai-news', title, order
  types.ts         # AiNewsDigest, AiNewsItem, AiNewsCategory, AiNewsState
  api.ts           # Hono routes
  api.test.ts
  ui.tsx
  ui.module.css
  package.json
  tsconfig.json

server/src/lib/
  ai-news.ts             # CRUD: list digests, read one, toggle star, prune
  ai-news.test.ts
  ai-news-prompt.ts      # buildPrompt + parseLLMOutput type guard
  ai-news-prompt.test.ts
  ai-news-processor.ts   # daily-run gate + hourly tick + single-flight
  ai-news-processor.test.ts
```

- `web/src/panels.ts` and `server/src/routes.ts` get one import + one registry row each.
- `meta.order` is `60` (after Journals at `50`, before any future panel).

## 5. Data model

### 5.1 Shared types

```ts
export type AiNewsCategory =
  | 'tool'        // Claude Code, Cursor, Copilot, Cody, Aider, Windsurf, etc.
  | 'model'       // Claude/GPT/Gemini/Llama releases, coding benchmarks
  | 'protocol'    // MCP, agent frameworks, tool-use standards
  | 'research'    // papers on AI-assisted coding, agent eval, RAG-for-code
  | 'community';  // notable blog posts, build logs

export const CATEGORY_VALUES: AiNewsCategory[] = [
  'tool', 'model', 'protocol', 'research', 'community',
];

export type AiNewsItem = {
  id: string;              // ULID assigned server-side at write time
  title: string;           // <= 80 chars
  oneLineSummary: string;  // <= 140 chars
  url: string;             // canonical source URL
  category: AiNewsCategory;
  starred: boolean;
};

export type AiNewsDigest = {
  date: string;            // YYYY-MM-DD (matches filename)
  runAt: string;           // ISO timestamp
  summary: string;         // markdown, one short paragraph (~3 sentences)
  items: AiNewsItem[];     // typically 10, tolerate 5..15
};

export type AiNewsState = {
  isRunning: boolean;
  lastRunAt?: string;      // ISO
  lastError?: string;      // cleared on next success
};
```

### 5.2 Storage

Everything under `~/.claude/ai-news/`:

```
~/.claude/ai-news/
  digests/
    2026-04-21.json    # { date, runAt, summary, items: [...] }
    2026-04-20.json
    ...
  state.json           # { isRunning, lastRunAt, lastError? }
```

- One file per digest, keyed by local-date `YYYY-MM-DD` (the server's local timezone is the source of truth for "today").
- Starred flag lives on the item inside its origin digest file. No separate stars index.
- `state.json` is writable from the processor path only; API handlers read it but do not mutate it directly.

## 6. LLM contract

### 6.1 Prompt

Built by `buildPrompt()` (pure function, no args today but may take config later):

```
You are a daily news curator for an AI-assisted-development dashboard.

Task: using web search, produce today's top 10 news items across these
categories: tool (Claude Code/Cursor/Copilot/Cody/Aider/Windsurf…),
model (Claude/GPT/Gemini/Llama releases + coding benchmarks), protocol
(MCP, agent frameworks, tool-use standards), research (papers on
AI-assisted coding, agent eval, RAG-for-code), community (notable
blog posts, build logs).

Rules:
- Only items from the last 48 hours. Skip older news even if relevant.
- Prioritize announcements with concrete changes (shipped features,
  released models, merged specs) over think-pieces.
- Diversify categories: don't return 10 tool items.
- Each item: headline (<80 chars), one-line summary (<140 chars),
  canonical source URL (prefer the vendor/paper/GitHub link, not news
  aggregators), and category from the set above.
- summary: one short paragraph (~3 sentences) naming the biggest
  2-3 stories of the day, written for a working developer.

Output ONLY a single JSON object matching this schema, no prose:

{
  "summary": "string",
  "items": [
    { "title": "string", "oneLineSummary": "string",
      "url": "string", "category": "tool|model|protocol|research|community" }
  ]
}
```

### 6.2 Output parsing

`parseLLMOutput(raw: string): AiNewsDigestPayload | null`

- Strip markdown fences using the same fence-tolerant helper pattern from `braindump-prompt.ts` (post-`29d106f`).
- Type guard:
  - `summary: string`, non-empty.
  - `items: Array`, length in `[1, 15]` (tolerate under/overshoot around the 10-target).
  - Each item: four string fields present; `category` in `CATEGORY_VALUES`.
- Returns `null` on any shape mismatch — the processor treats `null` as a failed run (records `lastError: 'invalid LLM output'`, keeps the previous digest alive).
- IDs are **not** in the LLM output; the processor assigns a ULID to each item before writing.

### 6.3 Invocation

- `runClaude({ prompt, input: '', timeoutMs: 180_000 })` — reuses the exported `defaultRunClaude` from `braindump-processor.ts`.
- Timeout bumped from braindump's 120s to 180s: web search + reasoning takes longer than text tidying.
- If the CLI exits non-zero or times out, the processor captures the error message and records it in `state.lastError`.

## 7. Scheduler (`ai-news-processor.ts`)

### 7.1 Boot

- `main.ts` starts the processor after the braindump processor.
- On boot, unconditionally reset `state.isRunning = false` (crash recovery).
- Kick off one immediate tick, then `setInterval(tick, 60 * 60 * 1000)` (hourly).

### 7.2 Tick

```
async function tick() {
  const state = await readState();
  if (state.isRunning) return;                  // single-flight

  const today = formatLocalDate(new Date());    // YYYY-MM-DD
  if (await digestExists(today)) return;         // done for today

  const hour = new Date().getHours();
  if (hour < 7) return;                          // too early

  await runDigest({ targetDate: today, force: false });
}
```

### 7.3 `runDigest({ targetDate, force })`

1. Write `state.json` with `{ isRunning: true, lastRunAt: state.lastRunAt, lastError: state.lastError }`.
2. `const raw = await runClaude({ prompt: buildPrompt(), input: '', timeoutMs: 180_000 })`.
3. `const payload = parseLLMOutput(raw)`. If `null` → treat as failure (step 6 with `lastError: 'invalid LLM output'`).
4. Assign a ULID to each item. Build `AiNewsDigest` with `date=targetDate`, `runAt=now`, `starred=false` per item.
5. Write `digests/${targetDate}.json` atomically (write to `.tmp`, rename). If `force && file exists`, overwrite.
6. On success: `state = { isRunning: false, lastRunAt: now, lastError: undefined }`. On failure: `state = { isRunning: false, lastRunAt: state.lastRunAt, lastError: <message> }`.
7. On success only, run `prune()`.

### 7.4 `prune()`

- List all files in `digests/`. For each file whose date < `today - 7 days`:
  - Read it. If `items.some(i => i.starred)` → keep.
  - Else `fs.unlink`.
- Swallow and log any per-file read/unlink error; do not fail the run.

### 7.5 Manual trigger

`POST /api/ai-news/run` calls `runDigest({ targetDate: today, force: true })` on a non-awaited promise and returns `ok({ triggered: true })` (200) immediately. If `state.isRunning` at entry → respond `fail('RUN_IN_PROGRESS', ...)` with status 409.

## 8. HTTP API

All responses use the `Envelope<T>` pattern (`ok` / `fail` helpers from `@cc/server/envelope`).

| Method | Path | Success body | Errors |
|---|---|---|---|
| `GET` | `/api/ai-news/today` | `{ digest: AiNewsDigest \| null, state: AiNewsState }` | `READ_FAILED` (500) |
| `GET` | `/api/ai-news/starred` | `{ items: (AiNewsItem & { digestDate: string })[] }` | `READ_FAILED` (500) |
| `POST` | `/api/ai-news/digests/:date/items/:id/star` | `{ starred: boolean }` | `BAD_REQUEST`, `DIGEST_NOT_FOUND`, `ITEM_NOT_FOUND`, `WRITE_FAILED` |
| `POST` | `/api/ai-news/run` | `{ triggered: true }` | `RUN_IN_PROGRESS` (409), `SPAWN_FAILED` (500) |

### 8.1 Validation

- `:date` must match `/^\d{4}-\d{2}-\d{2}$/`.
- `:id` must match the project-wide `ID_REGEX` from the braindump panel (`/^[A-Za-z0-9-]+$/`) — blocks traversal.
- Star body: `{ starred: boolean }`. Any missing/wrong-typed field → `BAD_REQUEST`.

### 8.2 `/today` semantics

- `digest` is `null` when today's file doesn't exist yet. UI uses that to render the empty state without a second request.
- `state` is always returned so the UI can render "Running…" or "Failed" banners without an extra call.

### 8.3 `/starred` ordering

- Grouped by `digestDate` desc (newest first).
- Within a group, items appear in their original array order (preserves the LLM's ranking).
- Each starred item is decorated with `digestDate` so the UI can show a date chip.

## 9. UI

### 9.1 Panel header

```
[Digest]  [Starred]                                      [Refresh]
Last run 07:02 · 10 items              (or) Running…     (or) Failed: <msg>
```

- Refresh button disabled + small spinner when `state.isRunning`.
- Status strip reads from `state`: `Last run HH:MM · N items` / `Running…` / `Failed: <message>`.

### 9.2 Digest tab

- Empty state card when `digest === null`: "No digest yet today — running shortly" (when `isRunning`) or "Click Refresh to generate today's digest".
- Otherwise:
  - Exec summary block: `react-markdown` + `remark-gfm` (already in the project for journals), styled to match the journals body CSS.
  - Items list: 10 rows.
    - Row shape: `[CATEGORY-PILL] <title clickable> ... <star toggle>` on line 1, `<oneLineSummary>` on line 2.
    - Click on the title opens `url` in a new tab (`target="_blank" rel="noopener noreferrer"`).
    - Category pill colors (retrowave palette already in theme tokens):
      - `tool`: purple
      - `model`: pink
      - `protocol`: cyan
      - `research`: green
      - `community`: amber

### 9.3 Starred tab

- Flat list grouped by `digestDate` (sticky subheader: `Apr 20 · 3 starred`).
- Same row shape as Digest; star is filled by default.
- Unstarring fades out the row (CSS transition) and invalidates both queries.
- Empty state: "Nothing starred yet — star items from the Digest tab to pin them here."

### 9.4 Data fetching (TanStack Query)

- `['ai-news', 'today']` → `GET /api/ai-news/today`.
  - `refetchInterval: (query) => query.state.data?.state.isRunning ? 30_000 : false`.
- `['ai-news', 'starred']` → `GET /api/ai-news/starred`.
  - No interval; invalidated on star mutation settle.
- `useMutation` for star toggle:
  - Optimistic: update the cached digest / starred list immediately.
  - On error: rollback + error toast (simple inline amber warning — same pattern as worktree remove partial-success).
  - On settle: invalidate both queries.
- `useMutation` for manual run:
  - On settle: invalidate `today`; the query will flip `isRunning` true and polling kicks in.

### 9.5 Error isolation

Panel sits inside the app-level `ErrorBoundary` (per CLAUDE.md). A bad render here cannot take down sibling panels.

## 10. Security

- Consistent with project rules: server stays bound to `127.0.0.1`, no new outbound ports.
- `claude -p` already has filesystem access — nothing new here. Prompt does not include any secrets.
- URL values from the LLM are rendered into `<a href>` only with `rel="noopener noreferrer"`; click-through opens in a new tab. Body summaries render through `react-markdown` (which sanitizes by default). No `dangerouslySetInnerHTML`.
- Date/id regex guards block path traversal in the star endpoint.

## 11. Testing

### 11.1 `ai-news.ts`
- List digests (empty dir, missing dir, mix of valid/invalid files).
- Read one digest (happy, ENOENT → `DigestNotFoundError`, malformed → `DigestReadError`).
- Toggle star (happy, item not found, write failure).
- Prune (mix of old-with-stars, old-without-stars, recent — only old-without-stars deleted).

### 11.2 `ai-news-prompt.ts`
- `buildPrompt` returns a non-empty string containing category names.
- `parseLLMOutput` accepts a well-formed object with 10 items.
- Rejects: non-JSON, missing `summary`, empty `items`, item with unknown category, item with non-string URL, >15 items.
- Tolerates markdown fences (`json) and surrounding text (same fence-tolerant logic as braindump).

### 11.3 `ai-news-processor.ts`
- Injected `runClaude` + `now` + fs fakes.
- Skips tick when `isRunning`.
- Skips tick when today's digest already exists.
- Skips tick before 7am.
- Success path writes file, clears `lastError`, runs prune.
- Failure path keeps previous digest, writes `lastError`.
- Manual trigger with `force: true` overwrites existing file.
- `RUN_IN_PROGRESS` returned when triggered while `isRunning`.

### 11.4 `api.test.ts`
- Envelope shape, status codes, error codes.
- `/today` returns `{ digest: null, state }` when no file exists.
- `/starred` returns flat decorated list, grouped ordering.
- Star endpoint: happy, 404 for unknown date, 404 for unknown item, 400 for bad body.
- `/run`: 409 when `isRunning`, 200 otherwise.

## 12. Open questions / deferred

- Per-category filter chips in the Digest tab (v2 if signal-to-noise becomes a problem).
- Cross-digest de-duplication (the LLM currently sees no history; if "same story" keeps appearing two days in a row, revisit).
- Timezone configuration (assumes server's local TZ = user's TZ; fine for a solo local dashboard).
- Per-item note / "why I starred this" — relies on braindump capture (Cmd-Shift-B) for now.

## 13. Acceptance criteria

- 7am local (or first server boot after 7am), today's digest file appears at `~/.claude/ai-news/digests/YYYY-MM-DD.json` with 10 items across ≥3 categories.
- `GET /api/ai-news/today` returns `digest` populated and `state.lastRunAt` set.
- Digest tab renders summary + 10 rows, categorized with distinct pills.
- Starring an item toggles optimistically and persists across page refresh.
- Starred tab lists only starred items, grouped by date, newest first.
- After 8 days without stars, a digest file is gone from disk. A file with a starred item survives indefinitely.
- Manual Refresh replaces today's digest and the UI updates within one poll interval.
- All tests green under `pnpm -r test`.
