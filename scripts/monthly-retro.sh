#!/bin/bash
# Monthly retrospective safety net. Fires nightly; exits unless today is the
# last day of the month. Aggregates the month's weekly retros (falling back
# to daily journals if no weeklies exist) via `claude -p`.

set -euo pipefail

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

# Only run on the last day of the month (tomorrow's day-of-month will be 01),
# unless --force.
TOMORROW_DAY=$(date -v+1d +%d)
if [ "$FORCE" = "0" ] && [ "$TOMORROW_DAY" != "01" ]; then
  echo "Not last day of month — skipping monthly retro."
  exit 0
fi

MONTH=$(date +%Y-%m)
START="${MONTH}-01"
END=$(date +%Y-%m-%d)
OUT_DIR="$HOME/.claude/journals/monthly"
OUT="$OUT_DIR/$MONTH.md"
CLAUDE=/Users/sylvainb/.local/bin/claude

if [ -f "$OUT" ]; then
  echo "Monthly retro already exists for $MONTH — skipping."
  exit 0
fi

# Prefer weekly retros from this month. Fall back to daily journals.
INPUTS=()
INPUT_KIND="weekly"
for f in "$HOME"/.claude/journals/weekly/*.md; do
  [ -f "$f" ] || continue
  # Weekly filename is YYYY-Wnn. Extract YYYY and compare; we include the week
  # if its start date (Monday) is in this month. Cheapest proxy: check whether
  # the file's `period:` frontmatter's start date is in $MONTH.
  period_start=$(awk '/^period:/{print $2; exit}' "$f")
  if [[ "$period_start" == "$MONTH-"* ]]; then
    INPUTS+=("$f")
  fi
done

if [ "${#INPUTS[@]}" -eq 0 ]; then
  INPUT_KIND="daily"
  for f in "$HOME"/.claude/journals/daily/*.md; do
    [ -f "$f" ] || continue
    name=$(basename "$f" .md)
    fdate="${name:0:10}"
    if [[ "$fdate" == "$MONTH-"* ]]; then
      INPUTS+=("$f")
    fi
  done
fi

if [ "${#INPUTS[@]}" -eq 0 ]; then
  echo "No journals or weekly retros found for $MONTH — skipping."
  exit 0
fi

PROMPT="Aggregate the following $INPUT_KIND journals from month $MONTH ($START to $END) into a monthly retrospective. Output ONLY the retrospective markdown to stdout — do NOT use the Write tool, do NOT ask for permissions, just print the markdown. Your entire response must start with '---' (the frontmatter opener) and end after the Strategic Recommendations section.

Use this exact structure:

---
type: monthly
month: $MONTH
period: $START to $END
weeks: <count of weekly retros, or 0 if aggregating daily>
total_sessions: <sum across sources>
repos: [<unique repos>]
---

## Summary
3-5 sentences on the month's arc — major themes, shifts in focus, overall trajectory.

## Accomplishments
Grouped by theme or initiative, not by week. The 'what did we ship' section.

## Productivity Patterns
Repo attention distribution, session frequency trends, work type distribution, week-over-week trends.

## Recurring Blockers
Systemic patterns that persisted across multiple weeks.

## Technical Debt Flagged
Items that have been deferred for multiple weeks. Accumulation trends. Risks.

## Process Improvements
Process changes tried and their outcomes. Friction patterns that persisted all month. What worked consistently.

## Trend Analysis
What's improving week over week. What's declining or stagnating. New patterns that emerged.

## Strategic Recommendations
3-5 directional suggestions. Beyond tactical — strategic ('stability sprint' type moves).

--- $INPUT_KIND JOURNALS FOLLOW ---
"

for f in "${INPUTS[@]}"; do
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
