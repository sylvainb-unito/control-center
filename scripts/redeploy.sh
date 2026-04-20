#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

pnpm install
pnpm --filter @cc/web build
launchctl kickstart -k "gui/$(id -u)/io.unito.control-center"
echo "redeployed — http://localhost:7777"
