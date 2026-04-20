#!/usr/bin/env bash
set -euo pipefail

# Installs the Control Center launchd agent.
# Runs the Hono server via tsx on port 7777, bound to 127.0.0.1.
# Logs go to ~/Library/Logs/control-center.log

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
TSX_BIN="$REPO_DIR/node_modules/.bin/tsx"
PLIST_LABEL="io.unito.control-center"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/control-center.log"

if [[ -z "$NODE_BIN" ]]; then
  echo "error: node not found in PATH. Run 'nvm use' first." >&2
  exit 1
fi

if [[ ! -x "$TSX_BIN" ]]; then
  echo "error: tsx not found at $TSX_BIN. Run 'pnpm install' first." >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
mkdir -p "$(dirname "$PLIST_PATH")"

# Build PATH for the agent's EnvironmentVariables so `gh` and other CLIs resolve.
# Keep it minimal: homebrew (both arches), system bins, and the repo's own node_modules/.bin.
AGENT_PATH="$REPO_DIR/node_modules/.bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

cat >"$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$PLIST_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$TSX_BIN</string>
    <string>$REPO_DIR/server/src/main.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$AGENT_PATH</string>
    <key>PORT</key><string>7777</string>
    <key>BIND_HOST</key><string>127.0.0.1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_FILE</string>
  <key>StandardErrorPath</key><string>$LOG_FILE</string>
</dict>
</plist>
PLIST

# Reload if already present.
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo "installed $PLIST_LABEL"
echo "logs: $LOG_FILE"
echo "open http://localhost:7777"
