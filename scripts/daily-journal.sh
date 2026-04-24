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
  commits=$(git -C "$dir" log --branches --since="$SINCE" --author="$user_name" --oneline 2>/dev/null || true)
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
    commits=$(git -C "$dir" log --branches --since="$SINCE" --author="$user_name" \
      --pretty=format:"%h%x1f%D%x1f%s")
    echo
    echo "### $repo"
    while IFS=$'\x1f' read -r hash refs msg; do
      branch=$(printf '%s' "$refs" | awk -F', *' '{
        for (i=1; i<=NF; i++) {
          r = $i; sub(/^HEAD -> /, "", r)
          if (r != "" && r !~ /^tag: / && r !~ /^origin\//) { print r; exit }
        }
      }')
      if [ -z "$branch" ]; then
        branch=$(git -C "$dir" branch --contains "$hash" \
          --format="%(refname:short)" 2>/dev/null | head -1 || true)
      fi
      [ -n "$branch" ] || branch="(unreachable)"
      echo "- \`$hash\` [\`$branch\`] $msg"
    done <<< "$commits"
  done
  echo
  echo "## Repos & Branches Touched"
  for repo in $ACTIVE_REPOS; do
    dir="$HOME/Workspace/$repo"
    user_name=$(git -C "$dir" config user.name)
    branches=$(git -C "$dir" log --branches --since="$SINCE" --author="$user_name" \
      --pretty=format:"%H" | while read -r sha; do
        git -C "$dir" branch --contains "$sha" \
          --format="%(refname:short)" 2>/dev/null | head -1
      done | sort -u | paste -sd ',' -)
    echo "- $repo: \`${branches:-(unknown)}\`"
  done
} > "$OUT"

echo "Wrote $OUT"
