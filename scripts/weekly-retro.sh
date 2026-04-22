#!/bin/bash
# Weekly retrospective safety net. Fires nightly; exits unless today is Sunday.
# Aggregates the week's daily journals into a retro via `claude -p` (bash
# handles the final Write since ~/.claude/ is a sensitive-location for claude).

set -euo pipefail

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

# Only run on Sundays (POSIX day 7 = Sunday), unless --force.
if [ "$FORCE" = "0" ] && [ "$(date +%u)" != "7" ]; then
  echo "Not Sunday — skipping weekly retro."
  exit 0
fi

WEEK=$(date +%G-W%V)
START=$(date -v-mon +%Y-%m-%d)
END=$(date -v-mon -v+6d +%Y-%m-%d)
OUT_DIR="$HOME/.claude/journals/weekly"
OUT="$OUT_DIR/$WEEK.md"
CLAUDE=/Users/sylvainb/.local/bin/claude

if [ -f "$OUT" ]; then
  echo "Weekly retro already exists for $WEEK — skipping."
  exit 0
fi

# Collect daily journals whose filename date falls in [START..END].
JOURNALS=()
for f in "$HOME"/.claude/journals/daily/*.md; do
  [ -f "$f" ] || continue
  name=$(basename "$f" .md)
  fdate="${name:0:10}"
  if [[ "$fdate" > "$START" || "$fdate" == "$START" ]] && \
     [[ "$fdate" < "$END" || "$fdate" == "$END" ]]; then
    JOURNALS+=("$f")
  fi
done

if [ "${#JOURNALS[@]}" -eq 0 ]; then
  echo "No daily journals found for $WEEK — skipping."
  exit 0
fi

# Build the prompt: instructions + all journals inline.
PROMPT="Aggregate the following daily journals from ISO week $WEEK ($START to $END) into a weekly retrospective. Output ONLY the retrospective markdown to stdout — do NOT use the Write tool, do NOT ask for permissions, just print the markdown. Your entire response must start with '---' (the frontmatter opener) and end after the Recommendations section.

Use this exact structure (fill in content, keep the section headers):

---
type: weekly
week: $WEEK
period: $START to $END
sessions: <count of daily journals>
repos: [<unique repos across journals>]
---

## Summary
2-4 sentences describing the week's arc — main focus, shifts, overall trajectory.

## Accomplishments
Group by repo or theme, not by day. Deduplicate across sessions.

## Productivity Patterns
Session count, repo distribution, work-type distribution (features/bugs/refactors/ops), notable concentration or scatter.

## Recurring Blockers
Patterns across sessions. If no blockers were logged, note that explicitly.

## Technical Debt Flagged
Deferred items, things accumulating across sessions.

## Process Improvements
What worked, what was friction, any new process tried and its outcome.

## Recommendations
3-5 concrete, actionable suggestions for next week. Each specific enough to act on.

--- DAILY JOURNALS FOLLOW ---
"

for f in "${JOURNALS[@]}"; do
  PROMPT="$PROMPT

=== $(basename "$f") ===
$(cat "$f")
"
done

TMP=$(mktemp)
trap 'rm -f "$TMP" "${TMP}.clean"' EXIT

if ! printf '%s' "$PROMPT" | "$CLAUDE" -p --permission-mode bypassPermissions > "$TMP"; then
  echo "claude -p exited non-zero"
  cat "$TMP"
  exit 1
fi

# Strip any preamble before the first '---' frontmatter opener.
awk '/^---$/{found=1} found' "$TMP" > "${TMP}.clean"

if [ ! -s "${TMP}.clean" ]; then
  echo "Empty retro output from claude."
  cat "$TMP"
  exit 1
fi

mkdir -p "$OUT_DIR"
mv "${TMP}.clean" "$OUT"
trap - EXIT
rm -f "$TMP"
echo "Wrote $OUT"
