# Session-Sourced Journal Pipeline

## Why

The current journal skill has two data paths with very different fidelity:

- Live `/journal` reads the in-memory conversation and produces a rich entry (Summary, Completed, In Progress, Key Decisions, Blockers).
- The 23:00 launchd safety net runs a bash script that scans `git log` across `~/Workspace/*`. It has no LLM in the loop, so it can only render already-curated output — i.e. commit titles. Any exploration, review, decision, or failed experiment that didn't hit a commit is invisible to it. This data path also just produced a latent bug: `git log` without `--branches` silently dropped an entire day of feature-branch work in `integrations/`.

The underlying issue is that "what did I do today" lives primarily in Claude session transcripts, not in git. Git is an output, not a source.

This redesign makes session JSONL transcripts the canonical source for all journal invocations — live and cron — and deletes the git-scan path.

## Goals

- **One data source.** Every journal invocation reads session transcripts. No more "source: session vs source: git" fidelity split.
- **One skill, one prompt.** The live `/journal` invocation and the 23:00 cron invocation run the same skill with the same prompt. Nothing says "you are the cron version".
- **Regenerable output.** The journal is a derived artifact; any invocation for a given date produces the same quality output from the same input.

## Non-goals

- Redesigning the `/retro` skill. Retro reads daily journals and inherits the quality improvement automatically.
- Migrating existing `<date>-N.md` files or `source: cron-git` entries. They stay on disk. Retro already tolerates unknown frontmatter fields.
- Wiring a `/clear` session-end hook. Useful, but orthogonal — can land after this redesign is proven.
- Changing the `io.unito.daily-journal.plist` launchd schedule or shape. Only the script it invokes changes.

## Architecture

One skill, one canonical data source, two entry points, one output file per day.

```
 live /journal ──────┐
                     │
                     ├──▶  skills/journal/SKILL.md ──▶  ~/.claude/journals/daily/<date>.md
                     │
 launchd 23:00 ──────┘
 ↳ claude -p "/journal"
     │
     ▼
 discover today's JSONLs → extract.sh per file → concat → synthesize → write
```

### Entry points

| Trigger | Mechanism | Source for current session | Source for other today-sessions |
|---|---|---|---|
| Live `/journal` in an active session | User types `/journal` | In-memory conversation | `extract.sh` on JSONL |
| `launchd` at 23:00 | `claude -p "/journal"` | n/a (no live session) | `extract.sh` on JSONL |

Both paths land in the same "condensed signal → synthesize → write" flow.

### Pipeline

1. **Discover.** `find ~/.claude/projects -name "*.jsonl"` filtered by entry timestamps inside the file — file mtime is unreliable because JSONLs are appended across days.
2. **Source selection** per session:
   - Current live session: use in-memory conversation. The skill detects "we're running inside a live session" by checking whether a current-session ID is available via Claude Code's runtime (exact mechanism deferred to implementation — candidates: session-ID env var if exposed, or "conversation has non-trivial prior turns").
   - All other sessions with activity today: run `extract.sh <jsonl-path> --date <YYYY-MM-DD>`.
   - When invoked from cron via `claude -p`, there is no meaningful in-memory conversation, so every session today falls into the "other sessions" bucket — the pipeline is uniform.
3. **Split cross-day.** `extract.sh --date <YYYY-MM-DD>` filters entries by per-line timestamp. A session opened at 23:30 and continuing past midnight contributes to both days' journals with its corresponding slice.
4. **Filter trivial sessions.** Skip sessions with fewer than 3 user messages *and* 0 successful tool calls. Catches "opened Claude, said hi, /clear", `/config` drive-bys, misclicks.
5. **Synthesize.** The model reads the concatenated extract and produces the journal with Summary / Completed / In Progress / Key Decisions / Blockers / Repos Touched. Key Decisions and Blockers are always populated now — no longer conditional on source type.
6. **Write.** Single file `~/.claude/journals/daily/<date>.md`. Overwrites any prior regeneration of the same date.

## Components

### `skills/journal/SKILL.md` (agent-cli-toolkit — rewrite)

High-level instructions for Claude driving the pipeline. Replaces the current git-scanning mode. Covers:

- How to discover today's JSONLs (timestamp-filter, not mtime).
- How to identify the current live session to use in-memory context for it.
- How to invoke `extract.sh` and concatenate.
- The trivial-session filter threshold.
- The synthesis prompt.
- The output frontmatter and section structure.

### `skills/journal/extract.sh` (agent-cli-toolkit — new)

Pure bash + jq. Per-JSONL signal extraction. Accepts `<jsonl-path>` and optional `--date <YYYY-MM-DD>` to scope by entry timestamp.

Output is stable markdown the model can reason about.

Extraction rules per JSONL line type:

| Line type | Handling |
|---|---|
| `user` with text content | Verbatim |
| `user` with `tool_result` content | Truncate to ~200 chars; drop entirely for read-only tools (Read, Glob, Grep, LS) |
| `assistant` text | Verbatim |
| `assistant` `tool_use` | One-line summary: `Bash: <cmd>`, `Edit: <path>`, `Write: <path> (<size>)` — `Read`/`Glob`/`Grep` dropped |
| `assistant` `thinking` | Dropped |
| system/meta/empty | Dropped |

Target compression: ~20× on a typical day (20 MB raw → ~1 MB signal, well within a single-call context).

### `control-center/scripts/daily-journal.sh` (control-center — rewrite)

Becomes a tiny launchd bootstrapper. Responsibilities:

1. Augment PATH so `claude` resolves (same shape as the AI News panel's spawn).
2. Invoke `claude -p "/journal"` with a bounded timeout.
3. On non-zero exit: write `~/.claude/journals/daily/<date>.failed` containing exit code + last 20 lines of stderr. Exit 0 from the script itself so launchd doesn't retry-storm.
4. Log to `~/Library/Logs/daily-journal.log` as today.

### `~/Library/LaunchAgents/io.unito.daily-journal.plist`

Unchanged.

## Frontmatter & output format

```yaml
---
date: 2026-04-24
source: sessions          # stable constant; replaces session | git | cron-git
sessions: 3               # distinct session UUIDs that contributed
repos: [control-center, integrations]
started: "09:15"          # first meaningful entry today
ended: "22:48"            # last meaningful entry today
---
```

Body sections (all always populated; empty sections are omitted, not left blank):

- `## Summary` — 2-4 sentence narrative of the day.
- `## Completed` — bullet list.
- `## In Progress` — work started but not finished.
- `## Key Decisions` — decisions and their rationale.
- `## Blockers` — things that slowed or stopped work.
- `## Repos & Branches Touched` — per-repo, with branch(es).

Drops the `session: N` counter from the current frontmatter — no more numbered files per day. `source` is retained for future-proofing.

## Failure & edge cases

- **`claude -p` fails at 23:00** → bootstrapper writes `<date>.failed` marker with exit code + stderr tail. No silent-degradation fallback. Failures are surfaced, not hidden behind a lower-fidelity journal.
- **No session activity on date** → valid `<date>.md` with body `No session activity on <date>.` This is real data, not a failure.
- **Partial JSONL read failure** (malformed line, permission issue on one file) → `extract.sh` emits a warning to stderr, skips that file, continues. A partial journal is better than a missing one.
- **Session active across cron fire** → cron reads the JSONL up to the writer's current position; the next day's run picks up the tail. No coordination needed between cron and live Claude.
- **Idempotency** — re-running `/journal` for the same date (e.g. manual regeneration after the cron already ran) overwrites with the latest full-day view.

## Scope decisions

- **Hidden sessions** (the control-center `HiddenStore`): not honored. Hide state is UI-scoped; journals aggregate everything.
- **Git as cross-check**: dropped. No augmentation pass after synthesis.
- **`/clear` hook**: not in this spec. Can land later as a separate change that fires `/journal` from the Stop hook.
- **PR #126 in agent-cli-toolkit**: ships as-is with the `--branches` fix. This redesign lands as a follow-up PR stacked on `add-journal-retro-skills` so the stacking order stays clean when #126 merges to main.
- **Existing journals on disk**: untouched. `<date>-2.md`, `source: cron-git`, etc. stay as historical data. Retro already ignores unknown frontmatter fields.

## What changes vs. today

| | Today | New |
|---|---|---|
| Live `/journal` source | In-memory conversation only | In-memory for current session + JSONLs for everything else |
| Cron 23:00 source | `git log` in a bash script | `claude -p /journal` → same skill, same pipeline |
| Canonical data | Git commits (cron) or chat (live) | Session JSONLs |
| Files per day | 1-N numbered (`-2.md`, `-3.md`, …) | 1 regenerable `<date>.md` |
| `source` frontmatter | `session \| git \| cron-git` | `sessions` (constant) |
| Git scanning logic | Load-bearing in cron path | Removed |

## Testing

- **`extract.sh` (golden files).** Commit a fixture JSONL covering each line type (user text, user tool_result, assistant text, assistant tool_use for each of the summarized tools, assistant thinking, system meta) next to the script in `agent-cli-toolkit/skills/journal/test/`. Snapshot `extract.sh`'s stdout; assert deterministic output. Run via a tiny shell test harness (`test.sh`) in the same directory, invokable both from a developer's machine and from agent-cli-toolkit's CI if present.
- **Skill end-to-end.** Not unit-testable (LLM non-determinism). Manual verification: run `/journal` live at noon; manually invoke `claude -p "/journal"` as if from cron; compare outputs. Both should reflect the same set of sessions with comparable fidelity.
- **Bootstrapper.** Smoke test the failure path by invoking with a deliberately-broken `claude` binary on PATH; assert `.failed` marker is written and script exits 0.

## Rollout

1. Ship agent-cli-toolkit PR #126 (current `add-journal-retro-skills` branch with the `--branches` fix). Gives everyone the safety-net improvement immediately.
2. Land this redesign as a follow-up PR in agent-cli-toolkit (new `extract.sh`, rewritten `SKILL.md`) stacked on `add-journal-retro-skills` or rebased onto `main` after #126 merges.
3. Land the control-center change (`scripts/daily-journal.sh` rewrite + this spec) as a PR against `main`.
4. After both PRs merge, run one manual `/journal` invocation to produce today's journal from the new path; verify output matches expectations; leave launchd to take over the next evening.
