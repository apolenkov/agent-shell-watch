#!/bin/sh
# Runs the reproduction tests night-fix wrote for findings the plugin harness
# cannot exercise (repro.node.ts under node --test; repro.test.ts belongs to
# `claude plugin test`). Exits 0 when there are none.
set -eu
cd "$(dirname "$0")/.."
set -- tests/night-fix/*/repro.node.ts
[ -f "$1" ] || exit 0
exec node --test "$@"
