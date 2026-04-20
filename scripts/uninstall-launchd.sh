#!/usr/bin/env bash
set -euo pipefail

PLIST_LABEL="io.unito.control-center"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

launchctl unload "$PLIST_PATH" 2>/dev/null || true
rm -f "$PLIST_PATH"
echo "uninstalled $PLIST_LABEL (logs preserved at ~/Library/Logs/control-center.log)"
