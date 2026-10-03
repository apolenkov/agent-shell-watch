#!/bin/sh
# Runs `claude plugin <args> <mod>` for every folder under mods/ that holds a
# plugin manifest, stopping at the first failure.
set -eu
cd "$(dirname "$0")/.."
for mod in mods/*/; do
  [ -f "${mod}.claude-plugin/plugin.json" ] || continue
  claude plugin "$@" "$mod"
done
