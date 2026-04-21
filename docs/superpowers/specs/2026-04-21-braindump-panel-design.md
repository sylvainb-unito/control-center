# Braindump Panel — Design

Date: 2026-04-21
Status: Approved (v1 scope)
Branch: `feat/panel-braindump`

## Purpose

A capture-first panel for dumping thoughts, TODOs, and read-later items from anywhere in the Control Center dashboard. Captured entries are plain markdown files in `~/.claude/braindumps/`. An hourly background job shells out to `claude -p` to categorize, title, summarize, and tag each entry. Processed entries surface in a filterable list; unprocessed or failed entries stay visible in an Inbox until handled.

v1 is local-only, solo-user, and deliberately small. "Acting on" entries (spawning a Claude Code session, converting a TODO to a worktree, opening detected URLs) is explicitly out of scope for v1 — see "Out of scope" below.

## Context

The dashboard already ships five panels (worktrees, pull-requests, shortcuts, claude-sessions, journals). The journals panel is the closest reference: markdown-with-frontmatter storage under `~/.claude/journals/`, lazy body fetch, tabbed list UI, typed Hono routes.

Braindump mirrors the journals pattern but adds two novel pieces:

- **Capture UX** — a modal with a Cmd-Shift-B global shortcut, reachable from any panel.
- **Background processing** — an in-process hourly tick that spawns `claude -p` to enrich entries.

## Architecture

New workspace `panels/braindump/`, wired through the two explicit registries:

- `web/src/panels.ts` — UI entry.
- `server/src/routes.ts` — API entry at `/api/braindump`.

**Moving parts:**

1. **Capture surface (web)** — Cmd-Shift-B global listener in `web/src/App.tsx` opens `<CaptureModal>`. The panel header also has a `+` button that opens the same modal. On save, POSTs to `/api/braindump`.
2. **Storage (server)** — one markdown-with-frontmatter file per entry at `~/.claude/braindumps/<id>.md`. Flat directory (no day subdirectories), journals-style filename sort.
3. **Server lib (`server/src/lib/braindump.ts`)** — filesystem CRUD: `createEntry`, `listEntries`, `readEntryBody`, `deleteEntry`, `reprocessEntry`. No subprocess concerns.
4. **Server lib (`server/src/lib/braindump-processor.ts`)** — scans for pending entries, spawns `claude -p`, updates state. `processPending(deps)` with injectable spawner and clock for tests.
5. **Server lib (`server/src/lib/braindump-prompt.ts`)** — the prompt string + type guard for LLM output.
6. **Processing loop** — `setInterval` kicked off in `server/src/main.ts`, hourly plus once on boot. Exposed as `POST /api/braindump/process` for a "Process now" button.
7. **Panel UI (`panels/braindump/ui.tsx`)** — two tabs (Processed default, Inbox), filter chips inside Processed, expandable rows.

**Dependency surface:** no new web deps. No new npm deps. Spawns `claude` via `node:child_process` like the existing claude-sessions open flow.

## Data model

**File:** `~/.claude/braindumps/<id>.md`

**ID format:** `YYYY-MM-DDTHH-mm-ss-<suffix>`, where `<suffix>` is exactly 4 characters from `[a-z0-9]` (e.g. `2026-04-21T14-32-08-a7f3`). Sortable lexicographically; the suffix prevents same-second collisions. The route-level validator regex is `/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[a-z0-9]{4}$/`.

**Frontmatter schema (YAML):**

```yaml
---
id: 2026-04-21T14-32-08-a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new | processing | processed | failed
# Populated by processor on success:
category: todo | thought | read-later
title: "Short 5-8 word list label"
summary: "One or two sentence summary shown on expand."
tags: ["project:control-center", "urgency:today"]
processedAt: 2026-04-21T15:00:02.118Z
# Populated on failure:
failure:
  attempts: 2
  lastError: "claude -p exited with code 1"
  lastAttemptAt: 2026-04-21T15:00:02.118Z
---
<raw captured text, verbatim, as the markdown body>
```

Fields present only when applicable:

- `category`, `title`, `summary`, `tags`, `processedAt` — set when `status: processed`.
- `failure` — set when the processor has attempted and failed at least once. Cleared on successful reprocess.

**State machine:**

| State | Meaning | Transitions |
|---|---|---|
| `new` | Written on capture, or on manual reprocess. Awaiting next processing tick. | → `processing` when tick picks it up |
| `processing` | `claude -p` is currently running for this entry. Guards against double-processing. | → `processed` on success, → `new` or `failed` on failure |
| `processed` | Terminal success. All processor fields populated. | → `new` via user-initiated reprocess |
| `failed` | `failure.attempts >= 3`. Stays in Inbox with a visible retry button. | → `new` via user-initiated retry |

**Tag shape:** free-form strings. Convention (suggested in the prompt) is lowercase, optionally `key:value` (`project:control-center`, `urgency:today`), but plain one-word tags are allowed. The UI renders whatever comes back.

## Data flow

### Capture

1. User hits Cmd-Shift-B or clicks `+`. `<CaptureModal>` opens, textarea auto-focused.
2. User types. Cmd-Enter saves; Esc cancels without saving.
3. `POST /api/braindump` with `{ rawText: string }`.
4. Server validates: non-empty (after trim), length ≤ 8000 chars. Generates `id`. Writes `<id>.md` with `status: new`. Creates `~/.claude/braindumps/` lazily if missing.
5. Server responds `{ id }`. Client invalidates the `['braindump']` query so Inbox refreshes.
6. Modal closes, a short "Saved to Inbox" ephemeral toast plays (1.5s, matching the existing `rowFlash` feedback pattern). User stays on whichever panel they were viewing.

### Processing tick (hourly + on boot + manual)

1. **Reentrancy guard:** a module-level `isProcessing` flag in `braindump-processor.ts`. If a tick fires while `isProcessing`, it no-ops with a `debug` log.
2. Scan `~/.claude/braindumps/` for entries where `status === 'new'`.
3. For each pending entry, sequentially (not parallel — keeps `claude` CLI pressure sane and logs readable):
   1. Rewrite frontmatter with `status: processing`.
   2. Spawn `claude -p` via `node:child_process.spawn`. Pipe the prompt + raw text to stdin. 60-second timeout.
   3. Parse stdout as JSON. Validate against the expected schema using the type guard in `braindump-prompt.ts`.
   4. **On success:** rewrite frontmatter with `status: processed`, populated `category`/`title`/`summary`/`tags`/`processedAt`.
   5. **On failure** (non-zero exit, timeout, JSON parse error, schema mismatch): increment `failure.attempts`, set `status: failed` if `attempts >= 3`, else back to `new`. Record `lastError` and `lastAttemptAt`.
4. Log one summary line at end: `processed=N failed=M skipped=K`.

### `claude -p` prompt

Kept as a single constant in `braindump-prompt.ts`:

```
You are classifying a personal braindump entry. Respond with ONLY valid JSON matching:
{"category": "todo" | "thought" | "read-later",
 "title": "5-8 word list label",
 "summary": "1-2 sentence summary",
 "tags": ["optional", "up-to-3", "short", "tags"]}

Rules:
- Pick `todo` if the text describes something the user intends to do.
- Pick `read-later` if the text is primarily a URL, an article reference, or says "read/watch/check out X".
- Pick `thought` otherwise (ideas, reflections, rants, notes to self).
- Tags are optional. Use lowercase; prefer `key:value` for structured (project, urgency) but plain single words are fine.
- Output JSON ONLY — no prose, no code fence.

Entry:
<raw text>
```

### List read

`GET /api/braindump` returns:

```ts
{
  inbox: EntrySummary[];      // status: new | processing | failed, newest-first
  processed: EntrySummary[];  // status: processed, newest-first
}
```

`EntrySummary` contains all frontmatter fields but omits the raw body. Body is lazy-fetched only when a row expands.

### Body read

`GET /api/braindump/:id` returns `{ rawText: string }`. `id` is validated against the ID regex (see Data model) before any filesystem call.

### Delete

`DELETE /api/braindump/:id` unlinks the file. Same ID regex guard.

### Reprocess / retry

`POST /api/braindump/:id/reprocess` resets `status` to `new` and clears the `failure` block. Next tick (or manual "Process now") picks it up. The Inbox "Retry" button on failed entries uses the same endpoint.

### Manual "Process now"

`POST /api/braindump/process` calls `processPending()` on demand. Respects the same reentrancy guard as the hourly tick.

## UI

**Panel header:** `Braindump` · `+` (opens modal) · `Process now` · `refresh`.

**Tabs:** `Processed` (default) · `Inbox`. Inbox label shows a count when non-zero: `Inbox (3)`.

### Processed tab

- Filter chip row: `All` (default) · `TODO` · `Thought` · `Read-later`. Active chip highlighted retrowave-cyan.
- Chronological list, newest-first, no day grouping in v1.
- **Row layout:** chevron · category pill (TODO=magenta, Thought=cyan, Read-later=yellow) · title · tag chips (muted, small) · time-ago (right-aligned).
- **Expanded row:** summary paragraph · raw text block (monospace, scrollable if long) · footer with `Re-process` and `Delete` buttons (dim until hover).
- Clicking the row chevron toggles expand. Enter/Space also toggle (keyboard parity with journals).

### Inbox tab

- Same row shape as Processed, but the category pill is replaced by a **status pill**: `NEW` (dim blue), `PROCESSING` (pulsing cyan, like the claude-sessions live-dot), `FAILED` (danger-red).
- Title slot: for `new`/`processing` entries there's no processed title yet — show the first ~60 chars of raw text, ellipsized.
- Expanded row for `failed` entries shows the `failure.lastError` and a prominent `Retry` button (plus `Delete`).
- Zero state: "Nothing pending — waiting for the next processing tick."

### Capture modal (`<CaptureModal>`)

- Centered overlay, semi-transparent backdrop, retrowave-bordered card.
- Header: "Braindump".
- Body: multi-line textarea, auto-focused, ~6 rows default, auto-grows up to ~20 rows.
- Footer: `Save (⌘↵)` · `Cancel (Esc)`. Character counter on the right, warn color near the 8000 limit.
- On save success: modal closes, "Saved to Inbox" toast for 1.5s, user stays on their current panel/tab.
- Triggered by Cmd-Shift-B (registered in `web/src/App.tsx`) or panel header `+`.

### Panel meta

- `id: 'braindump'`, `title: 'Braindump'`, `order: 60` (after journals), `defaultSize: 'md'`.

### Styling

All styles in `panels/braindump/ui.module.css` and a new `web/src/components/CaptureModal.module.css`. Reuse theme variables (`--accent-cyan`, `--accent-magenta`, `--danger`, `--fg-dim`, etc.) from `web/src/theme/`. No new global CSS.

## Isolation and module boundaries

| Unit | Responsibility | Public surface | Dependencies |
|---|---|---|---|
| `server/src/lib/braindump.ts` | Filesystem CRUD, frontmatter (de)serialization, ID generation | `createEntry`, `listEntries`, `readEntryBody`, `deleteEntry`, `reprocessEntry` — all over a configurable base dir for tests | `node:fs`, existing `fs-helpers.ts` |
| `server/src/lib/braindump-processor.ts` | Spawn `claude -p`, parse response, drive the state machine | `processPending(deps)` — `deps` injects spawner + clock | `braindump.ts`, `braindump-prompt.ts` |
| `server/src/lib/braindump-prompt.ts` | Prompt constant + LLM-output type guard | `PROMPT`, `isValidLlmOutput(x): x is LlmOutput` | none |
| `panels/braindump/api.ts` | HTTP wiring, envelope wrapping, ID regex validation | Hono route module | the three libs above |
| `panels/braindump/ui.tsx` | Rendering; state via TanStack Query | `UI` | `fetchJson`, `<CaptureModal>` |
| `web/src/components/CaptureModal.tsx` | Modal + keyboard handling | `<CaptureModal open onClose />` | `fetchJson` |
| `web/src/lib/useGlobalShortcut.ts` | Generic Cmd-Shift-X keyboard listener | `useGlobalShortcut(combo, handler)` | none |

Splitting the processor out of `braindump.ts` keeps the filesystem module small and trivially testable (no subprocess concerns), and lets the processor be tested by stubbing the spawner.

## Error handling

- **Capture errors** (disk full, permission denied): server returns `Envelope` `{ ok: false, code: 'WRITE_FAILED', message }`. Modal stays open, surfaces the error inline, user can retry.
- **List errors** (corrupt frontmatter in one file): skip the corrupt file, log at `warn` with the filename, return the rest. One bad file must not hide 99 good ones.
- **Process errors:** bounded retry (≤3 attempts) → terminal `failed`. 60-second timeout per entry. Unparseable JSON or schema mismatch is a hard failure counted as an attempt.
- **Concurrent ticks:** reentrancy guard in the processor. Hourly timer and manual `POST /api/braindump/process` both respect it.
- **Missing `~/.claude/braindumps/`:** `createEntry` creates it lazily. `listEntries` returns an empty result if the directory is absent.
- **ID injection:** strict regex validation on every route that takes `:id`. Same discipline as the claude-sessions `sessionId` hardening (see `1527563`).

## Security

- Server stays bound to `127.0.0.1` — no change.
- `claude -p` is invoked with stdin-piped text; no shell interpolation.
- Raw entry text may contain sensitive thoughts. Do **not** log raw text at `info` level. Raw text is logged only under `debug`. pino's existing redact config (`token`, `authorization`, `cookie`) remains untouched.
- Frontmatter never contains secrets.

## Testing

Mirror existing panel test conventions (vitest, node fixtures in temp dirs):

- **`braindump.test.ts`** — temp-dir CRUD: create writes expected frontmatter, list parses and sorts, delete unlinks, corrupt file is skipped with a `warn` log, invalid ID rejected.
- **`braindump-processor.test.ts`** — stubs the spawner. Covers: happy path (`new` → `processed` with all fields), timeout → failed-but-attempts-incremented, non-JSON output → hard failure, schema-mismatch output → hard failure, 3rd attempt flips to terminal `failed`, reentrancy guard blocks overlapping runs, `processing` state is set during the spawn.
- **`braindump-prompt.test.ts`** — exercises the type guard on known-good and known-bad JSON shapes.
- **`panels/braindump/api.test.ts`** — Hono route tests: POST creates, GET lists (inbox + processed split), GET `:id` returns body, DELETE removes, POST `:id/reprocess` resets status, POST `/process` is reentrancy-safe, all invalid IDs return 400.

No dedicated web UI tests (consistent with the rest of the codebase). The dev server (`pnpm dev`) is used for manual UI validation.

## Out of scope (v1)

These are deferred, not rejected. See memory `project_braindump_v2_ideas.md`.

- **Inline edit of entries.** v1 workaround: hand-edit the .md file on disk.
- **"Act on it."** Spawning a Claude Code session from a TODO, opening detected URLs, converting to a worktree. This was the long-term motivation that prompted the panel ("down the line, act on them"), so it is the most load-bearing v2 follow-up.
- **Full-text search** across raw + summary. `grep ~/.claude/braindumps/` is adequate until the corpus grows.
- **Category-specific structured fields** (e.g. `action`/`urgency` on todos, `url`/`estMinutes` on read-later). The uniform `title`/`summary`/`tags` schema covers v1 browsing. Add when the UI tells us it wants more.
- **Day grouping in the Processed list.** Add if the list gets uncomfortably long in practice.
- **A separate launchd agent for processing.** The in-process interval under the existing daemon is sufficient for a solo local tool.

## Files added / changed

**New:**

- `panels/braindump/{meta.ts,types.ts,api.ts,api.test.ts,ui.tsx,ui.module.css,package.json,tsconfig.json}`
- `server/src/lib/braindump.ts`, `braindump.test.ts`
- `server/src/lib/braindump-processor.ts`, `braindump-processor.test.ts`
- `server/src/lib/braindump-prompt.ts`, `braindump-prompt.test.ts`
- `web/src/components/CaptureModal.tsx`, `CaptureModal.module.css`
- `web/src/lib/useGlobalShortcut.ts`

**Changed:**

- `web/src/panels.ts` — register braindump entry.
- `server/src/routes.ts` — mount `/api/braindump`.
- `server/src/main.ts` — start the hourly processor tick (and one boot-time tick).
- `web/src/App.tsx` — register the Cmd-Shift-B global shortcut that opens `<CaptureModal>`.

## Commands

Unchanged — dev/test/build story identical to existing panels:

```bash
pnpm dev           # vite + hono
pnpm -r test       # all workspace tests
pnpm fix && pnpm check
```

## References

- Journals panel (`panels/journals/`, spec `docs/superpowers/specs/2026-04-20-journals-panel-design.md`) — closest structural reference.
- Claude-sessions panel (`panels/claude-sessions/`, commit `1527563`) — subprocess spawn discipline and ID regex guard.
- Foundation spec (`docs/superpowers/specs/2026-04-20-control-center-foundation-design.md`) — Envelope pattern, panel registries, error-boundary isolation.
