#!/usr/bin/env bash
# Roll ci-autofix.yml and night-review.yml out to the remaining repositories, one at a
# time (TASK-282.4). Per repository it is scripts/rollout-autofix.sh; this adds the order,
# the observation gate and the stop on the first problem.
#   scripts/rollout-all.sh            dry run of every target, then the gate verdict
#   scripts/rollout-all.sh --apply    apply to each target in turn: open the PR, wait for it to
#                                     merge, check the workflow landed on main, clean up, go on
# Stops at the first failure and says where. Re-run after fixing it: a target that already has
# ci-autofix.yml on main is skipped. multitracker is not listed: it is on hold (see its .conf).
# The gate: the observed repositories together show >= 3 clean Dependabot PRs, 0 incidents and 0
# suspects (autofix-report.sh counts the bot's PRs of every kind, not only Dependabot's).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
OWNER=apolenkov
TARGETS=(agent-mods jev-codex-router-lab feynman agent-autopilot agent-runner-guard)
OBSERVED=(agent-shell-watch agent-compact-advisor agent-council)
WAIT_MIN=${WAIT_MIN:-90} # per PR; CI queues of 13-24 minutes happen
apply=${1:-}

stop() { echo "STOP: $1" >&2; exit 1; }
has_autofix() { gh api "repos/$OWNER/$1/contents/.github/workflows/ci-autofix.yml" --jq .name >/dev/null 2>&1; }

echo "== dry run of every target"
for r in "${TARGETS[@]}"; do
  if has_autofix "$r"; then echo "skip $r: ci-autofix.yml is already on main"; continue; fi
  "$here/rollout-autofix.sh" "$r" >"${TMPDIR:-/tmp}/rollout-$r.log" 2>&1 || { tail -12 "${TMPDIR:-/tmp}/rollout-$r.log" >&2; stop "dry run failed for $r"; }
  rm -f "${TMPDIR:-/tmp}/rollout-$r.log"
  echo "ok   $r"
done

echo "== observation gate"
clean=0 incidents=0 suspects=0
for r in "${OBSERVED[@]}"; do
  report=$("$here/autofix-report.sh" "$OWNER/$r" 14) || stop "autofix-report.sh failed for $r"
  c=$(sed -n 's/.*merged clean=\([0-9]*\).*/\1/p' <<<"$report")
  i=$(sed -n 's/^incidents: \([0-9]*\).*/\1/p' <<<"$report")
  s=$(sed -n 's/^suspects: \([0-9]*\).*/\1/p' <<<"$report")
  [ -n "$c" ] && [ -n "$i" ] && [ -n "$s" ] || stop "cannot read the numbers of the report for $r"
  echo "$r: clean=$c incidents=$i suspects=$s"
  clean=$((clean + c)) incidents=$((incidents + i)) suspects=$((suspects + s))
done
if [ "$clean" -ge 3 ] && [ "$incidents" -eq 0 ] && [ "$suspects" -eq 0 ]; then gate=open; else gate=closed; fi
echo "gate $gate (clean $clean of 3, incidents $incidents, suspects $suspects)"
[ "$apply" = --apply ] || { echo "dry run done. --apply only when the gate is open."; exit 0; }
[ "$gate" = open ] || stop "the gate is closed: no rollout before 3 clean Dependabot PRs, 0 incidents and 0 suspects"

for r in "${TARGETS[@]}"; do
  if has_autofix "$r"; then continue; fi
  echo "== apply $r"
  pr=$("$here/rollout-autofix.sh" "$r" --apply | tee /dev/stderr | sed -n 's/^opened \(.*\) with auto-merge on$/\1/p') || stop "apply failed for $r"
  [ -n "$pr" ] || stop "no PR URL from the apply of $r"
  merged=''
  for _ in $(seq "$WAIT_MIN"); do
    read -r state merge < <(gh pr view "$pr" --json state,mergeStateStatus --jq '"\(.state) \(.mergeStateStatus)"')
    [ "$state" = MERGED ] && { merged=1; break; }
    [ "$state" = CLOSED ] && stop "$pr was closed"
    [ "$merge" = BEHIND ] && gh pr update-branch "$pr" >/dev/null 2>&1 || true
    sleep 60
  done
  [ -n "$merged" ] || stop "$pr did not merge in $WAIT_MIN minutes (needs a look, e.g. a red check or an unresolved OCR thread)"
  has_autofix "$r" || stop "$pr merged but ci-autofix.yml is not on main of $r"
  "$here/rollout-autofix.sh" "$r" --cleanup
  echo "done $r: $pr"
done
echo "all targets rolled out. Next: scripts/autofix-report.sh <owner/repo> on each after the first Dependabot PR."
