#!/bin/sh
# Copies the API declarations the local Claude Code engine wrote into types/.
# The engine writes them when the plugin-authoring skill loads (run /plugin-authoring
# in any session first) and beside a mod loaded with --plugin-dir.
set -eu
cd "$(dirname "$0")/.."
src=$(ls -t /private/tmp/claude-*/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts \
  /tmp/claude-*/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts \
  mods/*/.claude-plugin/types/claude-code/index.d.ts 2>/dev/null | head -n 1 || true)
[ -n "$src" ] || { echo "no declarations found: run /plugin-authoring in a Claude Code session first" >&2; exit 1; }
cp "$src" types/claude-code.d.ts
head -n 1 types/claude-code.d.ts
