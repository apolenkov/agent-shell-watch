#!/bin/sh
# Live smoke of what a headless run cannot show: a real interactive session in
# tmux, with the stand-ins of demo/bin for the runners, checked on the captured
# screen: the status line is up, the runners view opens, a background runner's
# verdict is shown, and the exit note of the background task is not.
# Needs tmux and a Claude login; costs a few cents (haiku). Run: npm run smoke:live
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
session=aswsmoke$$
sandbox=/tmp/my-app

screen() { tmux capture-pane -t "$session" -p -J; }

# wait_for <pattern> <seconds>: poll the screen until the pattern shows.
wait_for() {
  i=0
  while [ "$i" -lt "$2" ]; do
    screen | grep -q -- "$1" && return 0
    sleep 1
    i=$((i + 1))
  done
  echo "FAIL: '$1' did not show in $2 s. Screen:" >&2
  screen >&2
  exit 1
}

cleanup() {
  tmux kill-session -t "$session" 2>/dev/null || true
  rm -rf "$sandbox" /tmp/my-app-home
}
trap cleanup EXIT

sh "$repo/demo/setup.sh"
tmux new-session -d -s "$session" -x 150 -y 45 \
  "unset CLAUDE_CODE_CHILD_SESSION CLAUDECODE; export PATH='$repo/demo/bin':\$PATH HOME=/tmp/my-app-home; cd $sandbox; claude --model haiku --plugin-dir '$repo' --setting-sources project,local --settings '{\"permissions\":{\"allow\":[\"Bash\"]},\"statusLine\":{\"type\":\"command\",\"command\":\"true\"},\"pluginConfigs\":{\"agent-shell-watch@inline\":{\"options\":{\"columns\":72}},\"agents-md@builtin\":{\"options\":{\"instructionFiles\":\"managed-only\"}}}}'"

wait_for '❯' 60
tmux send-keys -t "$session" "Run one Bash call in the background (run_in_background): pi -p 'fix flaky test' (description: Fix flaky test). Only run it, then wait for it to finish."
sleep 1
tmux send-keys -t "$session" C-m
wait_for 'completed (exit code' 120
# the status line is up: demo/setup.sh puts devin out of quota, the mod says so
wait_for '⏳ devin limit' 30

tmux send-keys -t "$session" "/shell-watch runners"
sleep 1
tmux send-keys -t "$session" C-m
wait_for 'runners · 1' 30
wait_for 'WAITING approval to edit' 30
echo "ok: status line up, runners view open, verdict shown"

# the pane's rows must not carry the engine's exit note under the verdict
if screen | grep -q '› \[exited with code'; then
  echo "FAIL: the exit note shows as the output tail of the row. Screen:" >&2
  screen >&2
  exit 1
fi
echo "ok: no exit note in the row's tail"
