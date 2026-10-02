#!/usr/bin/env sh
# Installs the autoharness extension into the GitHub Copilot app (user scope).
set -e
SRC="$(cd "$(dirname "$0")" && pwd)/extension/autoharness"
DEST="${COPILOT_HOME:-$HOME/.copilot}/extensions/autoharness"
mkdir -p "$DEST"
cp "$SRC/extension.mjs" "$SRC/lib.mjs" "$DEST/"
echo "Installed to $DEST"
echo "Next: in the Copilot app, ask the agent to run extensions_reload (or restart the app),"
echo "then follow automations/SETUP-PROMPT.md to create the Reflect and Curate automations."
