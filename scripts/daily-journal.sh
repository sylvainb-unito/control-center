#!/bin/bash
# Daily journal safety net. Invokes `claude -p "/journal"` once per day under
# launchd and writes the output to ~/.claude/journals/daily/<DATE>.md.
#
# Architectural split: the /journal skill synthesizes the journal markdown and
# emits it to stdout between sentinel markers. This script captures stdout,
# extracts the slice between markers, and writes the file. Keeping the sensitive
# write out of claude means we can grant it narrow, explicit Read/Bash allow
# rules instead of a blanket bypassPermissions.
#
# On any failure (non-zero exit, missing sentinels, empty content) writes a
# <DATE>.failed marker with the exit code + stderr tail, then returns 0 so
# launchd doesn't retry-storm.
#
# Wired up via ~/Library/LaunchAgents/io.unito.daily-journal.plist at 23:00 daily.

set -euo pipefail

DATE=$(date +%Y-%m-%d)
JOURNAL_DIR="$HOME/.claude/journals/daily"
OUT="$JOURNAL_DIR/$DATE.md"
FAILED_MARKER="$JOURNAL_DIR/${DATE}.failed"
STDOUT_LOG=$(mktemp -t daily-journal-stdout.XXXXXX)
STDERR_LOG=$(mktemp -t daily-journal-stderr.XXXXXX)
TIMEOUT_SECS="${JOURNAL_TIMEOUT_SECS:-600}"

# Sentinels must match the skill's Output section in skills/journal/SKILL.md.
BEGIN_SENTINEL="<<<JOURNAL_BEGIN:${DATE}>>>"
END_SENTINEL="<<<JOURNAL_END>>>"

mkdir -p "$JOURNAL_DIR"

# Augment PATH so `claude` resolves under launchd (same pattern as the AI News
# panel's spawn). /opt/homebrew covers Apple Silicon; /usr/local covers Intel
# and npm-global; ~/.local/bin for user-installed.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

cleanup() { rm -f "$STDOUT_LOG" "$STDERR_LOG"; }
trap cleanup EXIT

fail_marker() {
  local reason="$1"
  {
    echo "date: $DATE"
    echo "exit_code: ${EXIT_CODE:-N/A}"
    echo "reason: $reason"
    if [ -s "$STDERR_LOG" ]; then
      echo "stderr_tail:"
      tail -20 "$STDERR_LOG"
    fi
    if [ -s "$STDOUT_LOG" ]; then
      local preserved="$JOURNAL_DIR/${DATE}.stdout.log"
      cp "$STDOUT_LOG" "$preserved"
      echo "stdout_preserved_at: $preserved"
    fi
  } > "$FAILED_MARKER"
}

if ! command -v claude >/dev/null 2>&1; then
  EXIT_CODE=127
  fail_marker "claude binary not found on PATH ($PATH)"
  exit 0
fi

# Narrow allowlist passed inline. Grants exactly what the /journal skill needs:
#   - read session JSONLs
#   - exec the skill's extract.sh (and the jq it drives)
# No Write permission to ~/.claude/ — this script writes the journal file
# outside claude, from the captured stdout.
ALLOW_SETTINGS=$(cat <<EOF
{"permissions":{"allow":[
  "Read(//$HOME/.claude/projects/**)",
  "Bash(bash $HOME/.claude/skills/journal/extract.sh:*)",
  "Bash(jq:*)",
  "Bash(find $HOME/.claude/projects:*)",
  "Bash(grep:*)"
]}}
EOF
)

set +e
# `--` ends option parsing so /journal lands as the positional prompt.
# Without it, --add-dir is variadic and swallows /journal as a second directory.
# `/journal all` flips the skill into aggregate mode (vs. per-session live
# which is the default). Positional argument is deterministic — env vars
# are unreliable through claude -p's prompt handoff.
timeout "$TIMEOUT_SECS" claude -p \
  --settings "$ALLOW_SETTINGS" \
  --add-dir "$HOME/.claude/projects" \
  -- \
  "/journal all" \
  > "$STDOUT_LOG" 2> "$STDERR_LOG"
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -ne 0 ]; then
  fail_marker "claude -p exited $EXIT_CODE"
  exit 0
fi

# Extract the journal markdown between sentinels. Using awk for a robust
# between-markers slice that doesn't include the sentinel lines themselves.
JOURNAL=$(awk -v begin="$BEGIN_SENTINEL" -v end="$END_SENTINEL" '
  $0 == begin { capturing = 1; next }
  $0 == end   { capturing = 0; exit }
  capturing   { print }
' "$STDOUT_LOG")

if [ -z "$JOURNAL" ]; then
  fail_marker "sentinels missing or empty content between them"
  exit 0
fi

printf '%s\n' "$JOURNAL" > "$OUT"

# Consolidate: the aggregate subsumes any per-session files for the same date.
# Glob `${DATE}-*.md` matches `2026-04-24-<short>.md` but not `2026-04-24.md`.
rm -f "$JOURNAL_DIR/${DATE}"-*.md

rm -f "$FAILED_MARKER"
exit 0
