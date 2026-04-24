# Session-Sourced Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the journal skill's two-path architecture (in-memory for live, git-scan for cron) with a single session-JSONL-based pipeline shared by both entry points.

**Architecture:** A new pure-bash `extract.sh` next to the skill pre-filters JSONL transcripts to meaningful signal (user prompts, assistant text, tool-call summaries; drop thinking and read-only tool noise). The skill's SKILL.md drives discovery and synthesis; the model reads the concatenated extract and produces the journal. Control-center's 23:00 launchd bootstrapper becomes a tiny wrapper that spawns `claude -p "/journal"` and writes a `.failed` marker on non-zero exit.

**Tech Stack:** Bash + jq (`extract.sh`), Claude Code skill files (SKILL.md), launchd (unchanged plist).

**Repos touched:**
- `agent-cli-toolkit` — new `extract.sh` + tests, rewritten `journal/SKILL.md`, small `retro/SKILL.md` patch. Branch `feat/session-sourced-journal` stacked on `add-journal-retro-skills` (since PR #126 is still open).
- `control-center` — rewritten `scripts/daily-journal.sh`. Branch `feat/session-sourced-journal` (already exists, spec committed as `fecf6ee` + `9f35756`).

---

## File Structure

### agent-cli-toolkit

| Path | Change | Purpose |
|---|---|---|
| `skills/journal/extract.sh` | Create | Per-JSONL signal extractor. Pure bash + jq. |
| `skills/journal/test/run.sh` | Create | Golden-file test harness. Diffs actual vs expected. |
| `skills/journal/test/fixtures/sample.jsonl` | Create | Small handcrafted JSONL covering every line type. |
| `skills/journal/test/expected/sample.md` | Create | Golden output for `extract.sh sample.jsonl` (no date filter). |
| `skills/journal/test/expected/sample-day1.md` | Create | Golden output for `--date 2026-04-23`. |
| `skills/journal/test/expected/sample-day2.md` | Create | Golden output for `--date 2026-04-24`. |
| `skills/journal/SKILL.md` | Rewrite | Remove git-scanning mode; describe the session-JSONL pipeline. |
| `skills/retro/SKILL.md` | Patch | Small targeted edit: sum `sessions:` from per-day frontmatter instead of counting files. |

### control-center

| Path | Change | Purpose |
|---|---|---|
| `scripts/daily-journal.sh` | Rewrite | Tiny launchd bootstrapper: `claude -p "/journal"` + `.failed` marker on failure. |

---

## Branch Setup (pre-task)

**Control-center:** already on `feat/session-sourced-journal`. Confirm:

```bash
cd /Users/sylvainb/Workspace/control-center
git status -sb   # expect: ## feat/session-sourced-journal
git log --oneline -2   # expect: 9f35756 and fecf6ee at the top
```

**Agent-cli-toolkit:** create branch off `add-journal-retro-skills`:

```bash
cd /Users/sylvainb/Workspace/agent-cli-toolkit
git fetch origin
git checkout add-journal-retro-skills
git pull origin add-journal-retro-skills
git checkout -b feat/session-sourced-journal
```

---

## Task 1: Scaffold test harness in agent-cli-toolkit

**Files:**
- Create: `agent-cli-toolkit/skills/journal/test/run.sh`
- Create: `agent-cli-toolkit/skills/journal/test/fixtures/.gitkeep`
- Create: `agent-cli-toolkit/skills/journal/test/expected/.gitkeep`

- [ ] **Step 1: Create directories and test runner**

```bash
cd /Users/sylvainb/Workspace/agent-cli-toolkit
mkdir -p skills/journal/test/fixtures skills/journal/test/expected
touch skills/journal/test/fixtures/.gitkeep skills/journal/test/expected/.gitkeep
```

Create `skills/journal/test/run.sh`:

```bash
#!/bin/bash
# Golden-file test harness for extract.sh.
# Runs extract.sh against fixtures and diffs output against expected files.
# Exit 0 = all tests pass; non-zero = at least one failure.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTRACT="$HERE/../extract.sh"
FIXTURES="$HERE/fixtures"
EXPECTED="$HERE/expected"

[ -x "$EXTRACT" ] || { echo "extract.sh not found or not executable: $EXTRACT" >&2; exit 1; }

declare -a CASES=(
  # label|fixture|args|expected
  "no-filter|sample.jsonl||sample.md"
  "date-day1|sample.jsonl|--date 2026-04-23|sample-day1.md"
  "date-day2|sample.jsonl|--date 2026-04-24|sample-day2.md"
)

FAIL=0
for case_spec in "${CASES[@]}"; do
  IFS='|' read -r label fixture args expected <<<"$case_spec"
  fixture_path="$FIXTURES/$fixture"
  expected_path="$EXPECTED/$expected"
  [ -f "$fixture_path" ] || { echo "SKIP $label: missing fixture $fixture_path"; continue; }
  [ -f "$expected_path" ] || { echo "SKIP $label: missing expected $expected_path"; continue; }

  # shellcheck disable=SC2086
  actual=$("$EXTRACT" "$fixture_path" $args 2>&1 || true)
  expected_content=$(cat "$expected_path")

  if [ "$actual" = "$expected_content" ]; then
    echo "PASS $label"
  else
    echo "FAIL $label"
    diff <(echo "$expected_content") <(echo "$actual") || true
    FAIL=$((FAIL + 1))
  fi
done

[ "$FAIL" -eq 0 ] || { echo "$FAIL test(s) failed"; exit 1; }
echo "all tests passed"
```

Make it executable:

```bash
chmod +x skills/journal/test/run.sh
```

- [ ] **Step 2: Verify the harness runs and reports missing files**

```bash
cd /Users/sylvainb/Workspace/agent-cli-toolkit
bash skills/journal/test/run.sh
```

Expected: the harness exits with code 1 (or prints SKIP lines if extract.sh doesn't exist yet and we make it error cleanly). Actually, at this step `extract.sh` doesn't exist so the first `[ -x "$EXTRACT" ]` check fails and we get `extract.sh not found`. Exit code 1. That's fine for now — it proves the harness is wired up.

- [ ] **Step 3: Commit**

```bash
git add skills/journal/test/
git commit -m "test(journal): scaffold golden-file test harness for extract.sh

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Handcraft fixture JSONL covering every line type

**Files:**
- Create: `agent-cli-toolkit/skills/journal/test/fixtures/sample.jsonl`

The fixture must exercise every line-type branch `extract.sh` will handle: user text, user tool_result (read-only + write), assistant text, assistant thinking, assistant tool_use (Bash, Edit, Write, Read, Glob), system, and span two distinct dates so the `--date` filter test has inputs.

- [ ] **Step 1: Write the fixture**

Create `skills/journal/test/fixtures/sample.jsonl` (one JSON object per line — keep on single lines):

```json
{"type":"user","timestamp":"2026-04-23T10:00:00Z","message":{"role":"user","content":"fix the failing tests"}}
{"type":"assistant","timestamp":"2026-04-23T10:00:05Z","message":{"content":[{"type":"thinking","thinking":"I should read the test file first to understand the failure."},{"type":"text","text":"I'll start by reading the test."},{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/foo/test.ts"}}]}}
{"type":"user","timestamp":"2026-04-23T10:00:06Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"describe('add', () => {\n  it('sums', () => { expect(add(1,2)).toBe(3) })\n})"}]}}
{"type":"assistant","timestamp":"2026-04-23T10:00:10Z","message":{"content":[{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"pnpm test","description":"run tests"}}]}}
{"type":"user","timestamp":"2026-04-23T10:00:30Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t2","content":"FAIL  test.ts\n  ✕ add > sums (1 ms)\n    Expected: 3\n    Received: 2"}]}}
{"type":"assistant","timestamp":"2026-04-23T10:00:35Z","message":{"content":[{"type":"text","text":"The add function returns the wrong value. Fixing."},{"type":"tool_use","id":"t3","name":"Edit","input":{"file_path":"/foo/src/add.ts","old_string":"a - b","new_string":"a + b"}}]}}
{"type":"assistant","timestamp":"2026-04-23T10:00:40Z","message":{"content":[{"type":"tool_use","id":"t4","name":"Write","input":{"file_path":"/foo/CHANGELOG.md","content":"# 1.0.1\n- fix add() typo\n"}}]}}
{"type":"assistant","timestamp":"2026-04-23T10:00:45Z","message":{"content":[{"type":"tool_use","id":"t5","name":"Glob","input":{"pattern":"**/*.test.ts"}}]}}
{"type":"user","timestamp":"2026-04-23T10:00:46Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t5","content":"/foo/test.ts\n/foo/other.test.ts"}]}}
{"type":"system","timestamp":"2026-04-23T10:00:47Z","subtype":"tool_denied","content":"skip-me"}
{"type":"assistant","timestamp":"2026-04-23T10:00:50Z","message":{"content":[{"type":"text","text":"All green now."}]}}
{"type":"user","timestamp":"2026-04-24T09:00:00Z","message":{"role":"user","content":"second-day prompt"}}
{"type":"assistant","timestamp":"2026-04-24T09:00:05Z","message":{"content":[{"type":"text","text":"second-day response"}]}}
```

- [ ] **Step 2: Verify it's valid JSONL**

```bash
jq -c . skills/journal/test/fixtures/sample.jsonl | wc -l
```

Expected: `13` (the count of lines; every line parsed successfully by jq).

- [ ] **Step 3: Commit**

```bash
git add skills/journal/test/fixtures/sample.jsonl
git commit -m "test(journal): fixture JSONL covering every line type

Covers user text, user tool_result (read-only Glob + write Bash),
assistant text, thinking, tool_use (Read/Bash/Edit/Write/Glob),
system metadata, and spans two distinct dates so the --date filter
test has inputs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extract.sh skeleton — args + line-type filter

**Files:**
- Create: `agent-cli-toolkit/skills/journal/extract.sh`
- Create: `agent-cli-toolkit/skills/journal/test/expected/sample.md`
- Create: `agent-cli-toolkit/skills/journal/test/expected/sample-day1.md`
- Create: `agent-cli-toolkit/skills/journal/test/expected/sample-day2.md`

- [ ] **Step 1: Create expected outputs covering ONLY Task 3's scope — empty output**

At this task boundary, extract.sh parses args and filters out unwanted line types but emits nothing yet. Each expected file is empty for now; subsequent tasks fill them in.

```bash
cd /Users/sylvainb/Workspace/agent-cli-toolkit
: > skills/journal/test/expected/sample.md
: > skills/journal/test/expected/sample-day1.md
: > skills/journal/test/expected/sample-day2.md
```

- [ ] **Step 2: Write the minimal extract.sh**

Create `skills/journal/extract.sh`:

```bash
#!/bin/bash
# Extract signal from a Claude Code session JSONL.
# Usage: extract.sh <jsonl-path> [--date YYYY-MM-DD]
# Emits condensed markdown to stdout; errors to stderr.
# Pure bash + jq. No external state.

set -euo pipefail

usage() {
  echo "usage: extract.sh <jsonl-path> [--date YYYY-MM-DD]" >&2
  exit 2
}

[ $# -ge 1 ] || usage
JSONL="$1"
shift || true

DATE_FILTER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --date)
      [ $# -ge 2 ] || usage
      DATE_FILTER="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

[ -r "$JSONL" ] || { echo "extract.sh: cannot read $JSONL" >&2; exit 1; }

# For now: emit nothing. Filtering and per-type handling land in later tasks.
# jq program scaffold — reads every line and either emits signal or skips.
jq -r --arg date "$DATE_FILTER" '
  # Date filter: if $date is set, require .timestamp to start with that date.
  select($date == "" or (.timestamp // "" | startswith($date))) |
  # Type filter: only user/assistant are potentially interesting.
  select(.type == "user" or .type == "assistant") |
  # Task 3 terminus: emit nothing yet.
  empty
' "$JSONL"
```

Make it executable:

```bash
chmod +x skills/journal/extract.sh
```

- [ ] **Step 3: Run the test harness**

```bash
bash skills/journal/test/run.sh
```

Expected: `PASS no-filter`, `PASS date-day1`, `PASS date-day2`, `all tests passed`.

- [ ] **Step 4: Commit**

```bash
git add skills/journal/extract.sh skills/journal/test/expected/
git commit -m "feat(journal): extract.sh skeleton — args + line-type filter

Reads a Claude Code session JSONL, accepts optional --date YYYY-MM-DD
filter, keeps only user/assistant entries. Emits no signal yet —
per-content-type handlers land in follow-up commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Emit user text and assistant text

**Files:**
- Modify: `agent-cli-toolkit/skills/journal/extract.sh`
- Modify: `agent-cli-toolkit/skills/journal/test/expected/sample.md`
- Modify: `agent-cli-toolkit/skills/journal/test/expected/sample-day1.md`
- Modify: `agent-cli-toolkit/skills/journal/test/expected/sample-day2.md`

- [ ] **Step 1: Update expected outputs to include text content**

This task adds emission of user text (string content) and assistant text content blocks. Everything else (tool_use, tool_result, thinking) still drops.

Write `skills/journal/test/expected/sample.md`:

```
fix the failing tests
I'll start by reading the test.
The add function returns the wrong value. Fixing.
All green now.
second-day prompt
second-day response
```

Write `skills/journal/test/expected/sample-day1.md`:

```
fix the failing tests
I'll start by reading the test.
The add function returns the wrong value. Fixing.
All green now.
```

Write `skills/journal/test/expected/sample-day2.md`:

```
second-day prompt
second-day response
```

- [ ] **Step 2: Update extract.sh to emit user text + assistant text**

Replace the `empty` placeholder in the jq program:

```bash
#!/bin/bash
set -euo pipefail

usage() {
  echo "usage: extract.sh <jsonl-path> [--date YYYY-MM-DD]" >&2
  exit 2
}

[ $# -ge 1 ] || usage
JSONL="$1"
shift || true

DATE_FILTER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --date)
      [ $# -ge 2 ] || usage
      DATE_FILTER="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

[ -r "$JSONL" ] || { echo "extract.sh: cannot read $JSONL" >&2; exit 1; }

jq -r --arg date "$DATE_FILTER" '
  select($date == "" or (.timestamp // "" | startswith($date))) |
  select(.type == "user" or .type == "assistant") |
  if .type == "user" then
    # User content is either a string (plain text) or array (tool_result).
    (.message.content // "") |
    if type == "string" then [.] else [] end
  elif .type == "assistant" then
    # Assistant content is always an array of content blocks.
    (.message.content // []) |
    map(
      if .type == "text" then .text
      else empty
      end
    )
  else [] end |
  .[]
' "$JSONL"
```

- [ ] **Step 3: Run the test harness**

```bash
bash skills/journal/test/run.sh
```

Expected: all three cases PASS.

- [ ] **Step 4: Commit**

```bash
git add skills/journal/extract.sh skills/journal/test/expected/
git commit -m "feat(journal): extract.sh emits user text + assistant text

User messages with string content emit verbatim. Assistant text
content blocks emit verbatim. Tool calls, tool results, and
thinking blocks still drop — follow-up commits add those.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Summarize assistant tool_use

**Files:**
- Modify: `agent-cli-toolkit/skills/journal/extract.sh`
- Modify: `agent-cli-toolkit/skills/journal/test/expected/sample.md`
- Modify: `agent-cli-toolkit/skills/journal/test/expected/sample-day1.md`
(Day-2 fixture has no tool_use, so `sample-day2.md` doesn't change.)

- [ ] **Step 1: Update expected outputs**

Add one-line tool summaries for Bash, Edit, Write. Drop Read and Glob entirely (read-only tools, noise).

Write `skills/journal/test/expected/sample.md`:

```
fix the failing tests
I'll start by reading the test.
Bash: pnpm test
The add function returns the wrong value. Fixing.
Edit: /foo/src/add.ts
Write: /foo/CHANGELOG.md (29B)
All green now.
second-day prompt
second-day response
```

Write `skills/journal/test/expected/sample-day1.md`:

```
fix the failing tests
I'll start by reading the test.
Bash: pnpm test
The add function returns the wrong value. Fixing.
Edit: /foo/src/add.ts
Write: /foo/CHANGELOG.md (29B)
All green now.
```

`sample-day2.md` stays unchanged (no tool_use on day 2).

- [ ] **Step 2: Update extract.sh**

Replace the assistant branch to handle tool_use:

```bash
jq -r --arg date "$DATE_FILTER" '
  # Read-only tools whose calls are dropped as noise.
  ["Read","Glob","Grep","LS","TodoWrite","TodoRead"] as $readonly |

  select($date == "" or (.timestamp // "" | startswith($date))) |
  select(.type == "user" or .type == "assistant") |
  if .type == "user" then
    (.message.content // "") |
    if type == "string" then [.] else [] end
  elif .type == "assistant" then
    (.message.content // []) |
    map(
      if .type == "text" then .text
      elif .type == "tool_use" then
        if ($readonly | index(.name)) then empty
        elif .name == "Bash" then "Bash: \(.input.command // "")"
        elif .name == "Edit" then "Edit: \(.input.file_path // "?")"
        elif .name == "Write" then "Write: \(.input.file_path // "?") (\(.input.content // "" | length)B)"
        else "\(.name): \(.input | tostring | .[:100])"
        end
      else empty
      end
    )
  else [] end |
  .[]
' "$JSONL"
```

- [ ] **Step 3: Run tests**

```bash
bash skills/journal/test/run.sh
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add skills/journal/extract.sh skills/journal/test/expected/
git commit -m "feat(journal): extract.sh summarizes assistant tool_use

Bash calls emit as 'Bash: <command>'. Edit/Write emit as
'Edit: <path>' and 'Write: <path> (<bytes>B)'. Read-only tools
(Read, Glob, Grep, LS, Todo*) drop entirely — they're navigation
noise. Other tools fall through to a generic name+args one-liner.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Emit tool_result — build id→name map, truncate, drop read-only

**Files:**
- Modify: `agent-cli-toolkit/skills/journal/extract.sh`
- Modify: `agent-cli-toolkit/skills/journal/test/expected/sample.md`
- Modify: `agent-cli-toolkit/skills/journal/test/expected/sample-day1.md`

A user `tool_result` entry references the originating `tool_use` by id. We need a two-pass approach: slurp the whole JSONL, build a `{tool_use_id → tool_name}` map, then for each `tool_result`, look up the tool name and decide whether to keep the result (truncated) or drop it (read-only).

- [ ] **Step 1: Update expected outputs**

Bash result gets truncated to 200 chars (our fixture result is short, so no truncation shown in golden — write the full result). Read result and Glob result drop entirely.

Write `skills/journal/test/expected/sample.md`:

```
fix the failing tests
I'll start by reading the test.
Bash: pnpm test
[Bash result] FAIL  test.ts
  ✕ add > sums (1 ms)
    Expected: 3
    Received: 2
The add function returns the wrong value. Fixing.
Edit: /foo/src/add.ts
Write: /foo/CHANGELOG.md (29B)
All green now.
second-day prompt
second-day response
```

Write `skills/journal/test/expected/sample-day1.md`:

```
fix the failing tests
I'll start by reading the test.
Bash: pnpm test
[Bash result] FAIL  test.ts
  ✕ add > sums (1 ms)
    Expected: 3
    Received: 2
The add function returns the wrong value. Fixing.
Edit: /foo/src/add.ts
Write: /foo/CHANGELOG.md (29B)
All green now.
```

`sample-day2.md` unchanged.

- [ ] **Step 2: Update extract.sh to slurp + build map + emit**

Switch from line-stream to slurp, because we need the id→name map built before emitting:

```bash
jq -r --arg date "$DATE_FILTER" --slurp '
  ["Read","Glob","Grep","LS","TodoWrite","TodoRead"] as $readonly |

  # Pass 1: collect every (id, name) from assistant tool_use entries.
  (map(select(.type=="assistant") | .message.content // [] | .[] | select(.type=="tool_use") | {key: .id, value: .name}) | from_entries) as $tools |

  # Pass 2: per-entry emission.
  .[] |
  select($date == "" or (.timestamp // "" | startswith($date))) |
  select(.type == "user" or .type == "assistant") |
  if .type == "user" then
    (.message.content // "") as $c |
    if ($c | type) == "string" then [$c]
    elif ($c | type) == "array" then
      $c | map(
        if .type == "tool_result" then
          ($tools[.tool_use_id] // "?") as $tn |
          if ($readonly | index($tn)) then empty
          else "[\($tn) result] \(.content | tostring | .[:200])"
          end
        else empty
        end
      )
    else [] end
  elif .type == "assistant" then
    (.message.content // []) |
    map(
      if .type == "text" then .text
      elif .type == "tool_use" then
        if ($readonly | index(.name)) then empty
        elif .name == "Bash" then "Bash: \(.input.command // "")"
        elif .name == "Edit" then "Edit: \(.input.file_path // "?")"
        elif .name == "Write" then "Write: \(.input.file_path // "?") (\(.input.content // "" | length)B)"
        else "\(.name): \(.input | tostring | .[:100])"
        end
      else empty
      end
    )
  else [] end |
  .[]
' "$JSONL"
```

- [ ] **Step 3: Run tests**

```bash
bash skills/journal/test/run.sh
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add skills/journal/extract.sh skills/journal/test/expected/
git commit -m "feat(journal): extract.sh emits tool_result with id→name lookup

Slurps the JSONL and builds a tool_use_id → tool_name map so each
user tool_result can be classified. Read-only tool results
(Read/Glob/Grep/LS/Todo*) drop entirely. Other tool results emit as
'[<Tool> result] <content truncated to 200 chars>'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Smoke-test extract.sh against a real JSONL

**Files:** none modified. This is verification-only before moving on to the skill rewrite.

- [ ] **Step 1: Pick a real JSONL and diff**

```bash
cd /Users/sylvainb/Workspace/agent-cli-toolkit
REAL=$(find ~/.claude/projects -name "*.jsonl" -size +20k -size -5M 2>/dev/null | head -1)
echo "using: $REAL"
echo "--- first 80 lines of extract ---"
./skills/journal/extract.sh "$REAL" | head -80
echo "--- stats ---"
RAW_LINES=$(wc -l < "$REAL")
OUT_LINES=$(./skills/journal/extract.sh "$REAL" | wc -l)
echo "raw: $RAW_LINES lines; extract: $OUT_LINES lines"
```

Expected: extract is comprehensible prose + tool-call one-liners. Compression ratio is a qualitative check (typically 2-5×). No errors printed to stderr.

- [ ] **Step 2: Try --date**

```bash
TODAY=$(date +%Y-%m-%d)
./skills/journal/extract.sh "$REAL" --date "$TODAY" | wc -l
```

Expected: some number. Zero is OK if that JSONL has no activity today.

- [ ] **Step 3: No commit** (smoke test only).

---

## Task 8: Rewrite skills/journal/SKILL.md

**Files:**
- Modify: `agent-cli-toolkit/skills/journal/SKILL.md` (full rewrite)

Replace the git-scanning-mode skill with the session-JSONL pipeline skill.

- [ ] **Step 1: Read the current SKILL.md to confirm shape**

```bash
cat /Users/sylvainb/Workspace/agent-cli-toolkit/skills/journal/SKILL.md
```

(Sanity check that the file's current content matches the post-Task-1-of-PR126 state — i.e. has the `--branches` fix we landed. If anything looks off, stop and investigate.)

- [ ] **Step 2: Replace file contents**

Write `skills/journal/SKILL.md`:

````markdown
---
name: journal
description: >
  Generate a structured daily journal from Claude Code session transcripts.
  Runs live via /journal (uses in-memory context for the current session and
  reads JSONLs for the rest of today) or from a 23:00 launchd cron via
  `claude -p "/journal"` (reads JSONLs only). Writes ~/.claude/journals/daily/<date>.md.
---

# Session Journal

Generate a daily journal from today's Claude Code session transcripts.

## Determine Target Date

Unless the user explicitly passed a date argument, target today: `date +%Y-%m-%d`.

## Gather Sources

### Step 1: Discover today's sessions

Find every JSONL under `~/.claude/projects/**/*.jsonl` that has at least one entry whose `.timestamp` starts with the target date.

```bash
TARGET="$(date +%Y-%m-%d)"
for f in $(find ~/.claude/projects -name "*.jsonl"); do
  if jq -r '.timestamp // empty' "$f" | grep -q "^${TARGET}T"; then
    echo "$f"
  fi
done
```

File mtime is unreliable — JSONLs get appended across multiple days.

### Step 2: Identify the current live session, if any

If this invocation is happening inside a live session, the current session's transcript is already in your conversation context. The JSONL on disk for that session may lag the live state. For the current session, skip the JSONL read and use your in-memory conversation for the slice that falls within the target date.

Detect "am I live" by checking whether you have substantive prior turns in this conversation that match the target date. If you can't tell, default to treating every discovered JSONL as non-current.

### Step 3: Extract signal from each non-current JSONL

Resolve the skill's base directory, then run `extract.sh` per JSONL with the target date:

```bash
SKILL_DIR="$(dirname "$(find ~/.claude -name "extract.sh" -path "*/journal/*" | head -1)")"
for jsonl in $jsonls; do
  "$SKILL_DIR/extract.sh" "$jsonl" --date "$TARGET"
  echo "---"
done > /tmp/journal-signal.txt
```

Collect the concatenated signal plus, for the live session (if any), a condensed summary of what you did in it today.

### Step 4: Filter trivial sessions

Skip any per-JSONL extract that has fewer than 3 user messages *and* zero non-read-only tool calls. (Count user messages as lines that aren't prefixed with `[` or tool names. Count non-read-only tool calls as lines starting with `Bash:`, `Edit:`, `Write:`, etc.)

This catches "opened Claude, said hi, /clear", `/config` drive-bys, and misclicks.

## Synthesize

From the concatenated signal, produce the daily journal. Sections:

- **Summary** — 2-4 sentence narrative of the day's arc.
- **Completed** — bullet list of what was accomplished.
- **In Progress** — work started but not finished. Omit section if nothing applies.
- **Key Decisions** — decisions made and their rationale. Omit if none.
- **Blockers** — anything that slowed or stopped work. Omit if none.
- **Repos & Branches Touched** — per-repo line with branch name(s). Derive from `cwd` fields and any git-related activity you saw in the signal.

## Output

Write to `~/.claude/journals/daily/<TARGET>.md`. Overwrite if a file already exists — the journal is derived from the transcripts, so a regeneration for the same date is idempotent.

Frontmatter:

```yaml
---
date: <YYYY-MM-DD>
source: sessions
sessions: <count of distinct session UUIDs that contributed>
repos: [<comma-separated repo names>]
started: "<HH:MM>"
ended: "<HH:MM>"
---
```

`started` and `ended` are the first and last timestamps across all contributing signal, in local time.

## Edge Cases

- **No session activity today** — write `<TARGET>.md` with a one-line body `No session activity on <TARGET>.` This is real data, not a failure.
- **A JSONL fails to read** — log a warning to stderr, skip that file, keep going. A partial journal is better than a missing one.
- **Re-run for same date** — overwrite. Manual annotations belong elsewhere (retro, separate note).

## After Writing

Confirm: "Journal saved to `~/.claude/journals/daily/<TARGET>.md`"
````

- [ ] **Step 3: Sanity check — the skill parses as markdown with frontmatter**

```bash
head -5 /Users/sylvainb/Workspace/agent-cli-toolkit/skills/journal/SKILL.md
```

Expected: frontmatter present, no yaml errors.

- [ ] **Step 4: Commit**

```bash
git add skills/journal/SKILL.md
git commit -m "feat(journal): rewrite SKILL.md for session-JSONL pipeline

Replaces git-scanning mode with a session-transcript pipeline shared
between live /journal and the 23:00 launchd cron. Live invocations
use in-memory context for the current session and run extract.sh
on everything else; cron invocations run extract.sh on every
today-JSONL.

Frontmatter drops 'session: N' counter (single file per day now) and
pins 'source: sessions' as a stable constant.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Patch skills/retro/SKILL.md for sessions count

**Files:**
- Modify: `agent-cli-toolkit/skills/retro/SKILL.md`

Today retro's weekly frontmatter has `sessions: <count of daily journals>` — literally file-count. Under the new design every day produces exactly one file, so naively counting files undercounts real Claude activity. Change to sum the per-day `sessions:` field (with a fallback of `1` for legacy journals without that field).

- [ ] **Step 1: Locate and replace the weekly-gather instruction**

Find the block:

```markdown
1. Determine the current ISO week: `date +%G-W%V`
2. Determine the date range for this week (Monday to Sunday)
3. Read all daily journals from `~/.claude/journals/daily/` whose `date` frontmatter falls within this week
4. If no journals exist for this week, report: "No journals found for this week. Nothing to aggregate."
```

Replace with:

```markdown
1. Determine the current ISO week: `date +%G-W%V`
2. Determine the date range for this week (Monday to Sunday)
3. Read all daily journals from `~/.claude/journals/daily/` whose `date` frontmatter falls within this week
4. For each daily journal, read its `sessions:` frontmatter field. If the field is absent (legacy journals from before the session-sourced pipeline), count that file as `1`. The weekly `sessions:` total is the sum of these counts.
5. If no journals exist for this week, report: "No journals found for this week. Nothing to aggregate."
```

- [ ] **Step 2: Update the frontmatter comment in the weekly format block**

Find:

```
sessions: <count of daily journals>
```

Replace with:

```
sessions: <sum of per-day sessions counts; see gather step 4>
```

- [ ] **Step 3: Commit**

```bash
git add skills/retro/SKILL.md
git commit -m "fix(retro): sum per-day sessions count instead of counting files

Under the new session-sourced journal design, each day produces
exactly one daily file. Naively counting files under-reports real
Claude activity. Sum the daily frontmatter's 'sessions:' field
instead, with a '1-per-file' fallback for legacy journals that
don't carry it.

Keeps weekly/monthly retro counts semantically honest across the
transition between the old and new journal pipelines.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Rewrite control-center/scripts/daily-journal.sh as launchd bootstrapper

**Files:**
- Modify: `control-center/scripts/daily-journal.sh` (full rewrite)

- [ ] **Step 1: Replace the script**

Write `/Users/sylvainb/Workspace/control-center/scripts/daily-journal.sh`:

```bash
#!/bin/bash
# Daily journal safety net. Invokes `claude -p "/journal"` once per day under launchd.
# The journal skill itself reads ~/.claude/projects/**/*.jsonl and produces the
# daily entry at ~/.claude/journals/daily/<DATE>.md.
#
# On non-zero exit from claude, writes a <DATE>.failed marker with the exit code
# and stderr tail, then returns 0 so launchd doesn't retry-storm. Failures are
# surfaced via the marker; there is deliberately no lower-fidelity fallback.
#
# Wired up via ~/Library/LaunchAgents/io.unito.daily-journal.plist at 23:00 daily.

set -euo pipefail

DATE=$(date +%Y-%m-%d)
JOURNAL_DIR="$HOME/.claude/journals/daily"
FAILED_MARKER="$JOURNAL_DIR/${DATE}.failed"
STDERR_LOG=$(mktemp -t daily-journal-stderr.XXXXXX)
TIMEOUT_SECS="${JOURNAL_TIMEOUT_SECS:-600}"

mkdir -p "$JOURNAL_DIR"

# Augment PATH so `claude` resolves under launchd (same pattern as the AI News
# panel's spawn). /usr/local/bin covers Homebrew's npm global bin on Intel;
# /opt/homebrew/bin covers Apple Silicon; ~/.local/bin for user-installed.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

if ! command -v claude >/dev/null 2>&1; then
  {
    echo "date: $DATE"
    echo "exit_code: 127"
    echo "reason: claude binary not found on PATH"
    echo "PATH=$PATH"
  } > "$FAILED_MARKER"
  rm -f "$STDERR_LOG"
  exit 0
fi

# Run claude -p with a hard timeout. Capture stderr for the failure marker.
set +e
( timeout "$TIMEOUT_SECS" claude -p "/journal" ) 2> "$STDERR_LOG"
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -eq 0 ]; then
  rm -f "$FAILED_MARKER" "$STDERR_LOG"
  exit 0
fi

# Non-zero: write a failure marker with the exit code and stderr tail.
{
  echo "date: $DATE"
  echo "exit_code: $EXIT_CODE"
  echo "stderr_tail:"
  tail -20 "$STDERR_LOG" 2>/dev/null || true
} > "$FAILED_MARKER"

rm -f "$STDERR_LOG"
exit 0
```

- [ ] **Step 2: Verify it's executable and runs its trivial paths**

```bash
chmod +x /Users/sylvainb/Workspace/control-center/scripts/daily-journal.sh
```

Smoke test the "claude not found" failure path by running with an empty PATH:

```bash
FAILED_BEFORE=$(ls ~/.claude/journals/daily/*.failed 2>/dev/null | wc -l)
env -i HOME="$HOME" bash /Users/sylvainb/Workspace/control-center/scripts/daily-journal.sh
EXIT=$?
echo "exit: $EXIT"
ls ~/.claude/journals/daily/*.failed 2>/dev/null | tail -3
```

Expected: exit 0, a new `.failed` marker appears. Clean it up:

```bash
# If the marker for today is a test artifact, remove it. Inspect first:
cat ~/.claude/journals/daily/$(date +%Y-%m-%d).failed
# If it reads 'claude binary not found', it's the smoke-test artifact:
rm ~/.claude/journals/daily/$(date +%Y-%m-%d).failed
```

- [ ] **Step 3: Commit**

```bash
cd /Users/sylvainb/Workspace/control-center
git add scripts/daily-journal.sh
git commit -m "feat(daily-journal): rewrite as claude -p bootstrapper

Replaces the bash-level git-scanning implementation with a thin
launchd wrapper that spawns 'claude -p \"/journal\"'. The journal
skill itself (in agent-cli-toolkit) now does the real work:
reads ~/.claude/projects/**/*.jsonl, extracts signal via
extract.sh, synthesizes the daily entry.

On non-zero exit from claude (or claude missing from PATH), writes
a <date>.failed marker with exit code and stderr tail, then returns
0 so launchd doesn't retry-storm. No silent-degradation fallback —
failures are surfaced, not hidden.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: End-to-end smoke test

**Files:** none modified.

This is a manual verification step — run both entry points and compare outputs. Requires the agent-cli-toolkit changes to be installed to `~/.claude/skills/journal/` (via reconcile or symlink).

- [ ] **Step 1: Install the updated skill locally**

Either reconcile the plugin (if installed via plugin), or symlink the dev copy:

```bash
# If not installed via plugin, symlink:
ln -sf /Users/sylvainb/Workspace/agent-cli-toolkit/skills/journal \
  ~/.claude/skills/journal-dev
```

Whichever path you take, confirm `~/.claude/skills/journal/extract.sh` (or the dev copy) is the latest version:

```bash
diff ~/.claude/skills/journal/extract.sh \
  /Users/sylvainb/Workspace/agent-cli-toolkit/skills/journal/extract.sh
```

Expected: no diff (if reconciled) or "not a regular file" (if the installed version predates this PR, which is fine — dev copy is what counts).

- [ ] **Step 2: Run the cron path manually**

```bash
bash /Users/sylvainb/Workspace/control-center/scripts/daily-journal.sh
```

Expected: exits 0. Either produces today's `~/.claude/journals/daily/<DATE>.md` via the claude harness, or writes a `.failed` marker. If `.failed`, read it, fix the root cause, repeat.

- [ ] **Step 3: Inspect the output journal**

```bash
cat ~/.claude/journals/daily/$(date +%Y-%m-%d).md
```

Expected: valid frontmatter with `source: sessions`, `sessions: N`, `repos:`, `started:`, `ended:`. Body has Summary/Completed and the other sections as appropriate. Content reflects actual Claude activity today.

- [ ] **Step 4: No commit** (verification only).

---

## Task 12: Draft PRs

**Files:** none modified.

- [ ] **Step 1: Push agent-cli-toolkit branch and open draft PR**

```bash
cd /Users/sylvainb/Workspace/agent-cli-toolkit
git push -u origin feat/session-sourced-journal

gh pr create --draft \
  --base add-journal-retro-skills \
  --head feat/session-sourced-journal \
  --title "💨 [minor] session-sourced journal pipeline (stacked on #126)" \
  --body "$(cat <<'EOF'
## Summary

Replaces the journal skill's two-path architecture (in-memory for live, git-scan for cron) with a single session-JSONL-based pipeline shared by both entry points. Adds a pure bash + jq `extract.sh` that compresses a session transcript to meaningful signal (user prompts, assistant text, tool-call summaries) by dropping thinking blocks and read-only tool noise.

Also patches `retro/SKILL.md` so its weekly `sessions:` count sums the per-day frontmatter instead of counting files (files go from 1-N/day to 1/day under this design; counting files would look like a cliff across the transition).

Design doc: `control-center/docs/superpowers/specs/2026-04-24-session-sourced-journal-design.md` in the companion PR.

## Why

- The current 23:00 safety net is a bash script with no LLM in the loop, so it can only render `git log` titles. Decisions, blockers, failed experiments, reviews — all invisible.
- That path also just produced a latent bug where feature-branch commits dropped silently (fixed in #126 with `--branches`, but the underlying design fragility remains).
- Session JSONL transcripts are the canonical record of what happened. Use them.

## What's included

- `skills/journal/extract.sh` (new) — pure bash + jq signal extractor.
- `skills/journal/test/` (new) — golden-file test harness with a fixture covering every line type.
- `skills/journal/SKILL.md` (rewrite) — session-JSONL pipeline for both live and cron.
- `skills/retro/SKILL.md` (patch) — semantic `sessions:` count fix.

## Stacked on #126

This PR is based on `add-journal-retro-skills` (the branch behind #126). After #126 merges to main, this will be rebased onto main.

## Test plan

- [ ] \`bash skills/journal/test/run.sh\` — all three cases PASS
- [ ] \`skills/journal/extract.sh\` against a real JSONL produces readable signal; no errors to stderr
- [ ] Install locally (symlink or reconcile), run \`claude -p "/journal"\`, verify \`~/.claude/journals/daily/<DATE>.md\` has rich sections (Completed / In Progress / Key Decisions / Blockers / Repos)
- [ ] Run \`/retro weekly\` on a week that mixes legacy and new journals — \`sessions:\` count sums correctly (fallback to 1 per legacy file)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Push control-center branch and open draft PR**

```bash
cd /Users/sylvainb/Workspace/control-center
git push -u origin feat/session-sourced-journal

gh pr create --draft \
  --base main \
  --head feat/session-sourced-journal \
  --title "feat(daily-journal): session-sourced pipeline bootstrapper + spec" \
  --body "$(cat <<'EOF'
## Summary

Rewrites \`scripts/daily-journal.sh\` as a tiny launchd wrapper around \`claude -p "/journal"\`. The real journal logic moves out of bash into the agent-cli-toolkit journal skill, which now reads session JSONLs rather than scanning \`git log\`.

Includes the design spec at \`docs/superpowers/specs/2026-04-24-session-sourced-journal-design.md\`.

## Why

See the spec + the companion PR in agent-cli-toolkit. TL;DR: git-scan has no LLM in the loop and can only render commit titles; session transcripts have the full picture.

## Pairs with

agent-cli-toolkit PR [feat/session-sourced-journal] (stacked on #126). Merge order:
1. agent-cli-toolkit #126 (\`--branches\` safety-net fix)
2. agent-cli-toolkit follow-up (this redesign's skill side)
3. This PR (launchd bootstrapper + spec)

Once 1 and 2 ship, this PR becomes deployable.

## Test plan

- [ ] \`bash scripts/daily-journal.sh\` succeeds and produces today's journal via the new skill (after deps land)
- [ ] Smoke the failure path with \`env -i\` — \`.failed\` marker written, exit 0
- [ ] 23:00 launchd run the following evening produces a complete, rich journal

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Drop the PR URLs back into the conversation**

Both drafts. Sylvain will review and mark ready himself.

---

## Self-Review Checklist (plan author)

- **Spec coverage:**
  - Architecture / two entry points → Tasks 8 (skill), 10 (bootstrapper) ✓
  - extract.sh behavior → Tasks 3-6 ✓
  - Trivial-session filter → covered in Task 8's SKILL.md prose (step 4 under "Gather Sources") ✓
  - Cross-day split (`--date` flag) → Task 3 scaffold, Task 7 smoke verification ✓
  - Frontmatter changes (`source: sessions`, `sessions: N`, drop `session: N` counter) → Task 8 ✓
  - Retro `sessions:` count fix → Task 9 ✓
  - Failure handling (`.failed` marker, exit 0) → Task 10 ✓
  - Testing strategy (golden-file for extract.sh, manual for skill) → Tasks 1, 3-6, 11 ✓
  - Rollout order (PR #126 first, then skill PR, then control-center PR) → Task 12's PR body ✓

- **Placeholder scan:** No TBD / TODO / "add error handling" / "similar to Task N". Every code step shows the code. ✓

- **Type consistency:** Tool-name list used consistently across extract.sh tasks. `extract.sh <jsonl-path> [--date YYYY-MM-DD]` signature identical in every task. Frontmatter field names (`date`, `source`, `sessions`, `repos`, `started`, `ended`) match between Task 8's SKILL.md and Task 9's retro fix expectation. ✓
