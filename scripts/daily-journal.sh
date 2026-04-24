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
# panel's spawn). /opt/homebrew covers Apple Silicon; /usr/local covers Intel
# and npm-global; ~/.local/bin for user-installed.
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
