#!/bin/bash
# Daily journal safety net. Writes a markdown journal at
# ~/.claude/journals/daily/<DATE>.md from today's git activity across
# ~/Workspace/*, mirroring the journal skill's "git scanning mode".
# Skips if any journal already exists for today (manual /journal wins).
#
# Wired up via ~/Library/LaunchAgents/io.unito.daily-journal.plist
# at 23:00 daily; launchd catches up on wake if the slot was missed.

set -euo pipefail

DATE=$(date +%Y-%m-%d)
JOURNAL_DIR="$HOME/.claude/journals/daily"
OUT="$JOURNAL_DIR/$DATE.md"

if compgen -G "$JOURNAL_DIR/${DATE}*.md" > /dev/null; then
  echo "Journal already exists for $DATE — skipping."
  exit 0
fi

mkdir -p "$JOURNAL_DIR"

SINCE="$DATE 00:00"

ACTIVE_REPOS=""
for dir in "$HOME"/Workspace/*/; do
  [ -d "${dir}.git" ] || continue
  user_name=$(git -C "$dir" config user.name 2>/dev/null || echo "")
  [ -z "$user_name" ] && continue
  commits=$(git -C "$dir" log --since="$SINCE" --author="$user_name" --oneline 2>/dev/null || true)
  if [ -n "$commits" ]; then
    ACTIVE_REPOS="$ACTIVE_REPOS $(basename "$dir")"
  fi
done
ACTIVE_REPOS=$(echo "$ACTIVE_REPOS" | xargs)

if [ -z "$ACTIVE_REPOS" ]; then
  echo "No git activity today — skipping journal."
  exit 0
fi

{
  echo "---"
  echo "date: $DATE"
  echo "session: 1"
  echo "source: cron-git"
  echo "repos: [$(echo "$ACTIVE_REPOS" | tr ' ' ',' | sed 's/,/, /g')]"
  echo "started: unknown"
  echo "ended: unknown"
  echo "---"
  echo
  echo "## Completed"
  for repo in $ACTIVE_REPOS; do
    dir="$HOME/Workspace/$repo"
    user_name=$(git -C "$dir" config user.name)
    branch=$(git -C "$dir" branch --show-current 2>/dev/null || echo "(detached)")
    commits=$(git -C "$dir" log --since="$SINCE" --author="$user_name" --pretty=format:"%h %s")
    echo
    echo "### $repo (\`$branch\`)"
    while IFS= read -r line; do
      hash="${line%% *}"
      msg="${line#* }"
      echo "- \`$hash\` $msg"
    done <<< "$commits"
  done
  echo
  echo "## Repos & Branches Touched"
  for repo in $ACTIVE_REPOS; do
    dir="$HOME/Workspace/$repo"
    branch=$(git -C "$dir" branch --show-current 2>/dev/null || echo "(detached)")
    echo "- $repo: \`$branch\`"
  done
} > "$OUT"

echo "Wrote $OUT"
