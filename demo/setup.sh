#!/bin/sh
# Builds the sandbox the recording runs in: an empty project at /tmp/my-app and
# a throwaway HOME at /tmp/my-app-home. The mod reads the runners' limits and
# session files under $HOME, so the demo feeds it synthetic ones (the stand-ins
# in demo/bin write the session files while they run). The only link to the
# real home is the login keychain, so the recording can reach Claude.
set -e
home=/tmp/my-app-home
rm -rf "$home" /tmp/my-app
mkdir -p /tmp/my-app "$home/Library" "$home/.local/state/executor-limits"
ln -s "$HOME/Library/Keychains" "$home/Library/Keychains"
printf '%s\n' '{"hasCompletedOnboarding":true,"theme":"dark","projects":{"/tmp/my-app":{"hasTrustDialogAccepted":true},"/private/tmp/my-app":{"hasTrustDialogAccepted":true}}}' > "$home/.claude.json"
# devin is out of quota for the next three hours.
echo $(( $(date +%s) + 10800 )) > "$home/.local/state/executor-limits/devin"
