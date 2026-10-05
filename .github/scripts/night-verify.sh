#!/usr/bin/env bash
# Token-less checks of night-fix, run from the workspace root of one finding.
#   usage: NIGHT_ID=<12 hex> night-verify.sh repro|fixed
#   repro  normalizes the agent's verdict.json; for `confirmed` runs the reproduction
#          test, which must FAIL on an assertion (not on a syntax or import error)
#   fixed  after the fixer: the reproduction test must pass, then the whole `npm run check`
# The test code is the agent's, so it runs in a copy of the tree and the workspace
# stays clean for the patch. Writes verdict.json {id,status,evidence,lines,reason}
# and repro.log, and the step output `status`.
set -euo pipefail

mode=${1:?repro|fixed}
id=${NIGHT_ID:?}
[[ $id =~ ^[0-9a-f]{12}$ ]] || { echo "bad id"; exit 1; }
out=${GITHUB_OUTPUT:-/dev/stdout}
test_dir="tests/night-fix/$id"

# verdict <status> <reason> <evidence text> : rewrites verdict.json from the agent's
# lines (untrusted: kept as capped strings only).
verdict() {
  local lines='[]'
  [ -f verdict.raw.json ] && lines=$(jq -c '[(.lines // [])[]? | select(type == "string") | .[0:200]] | .[0:20]' verdict.raw.json 2>/dev/null || echo '[]')
  jq -n --arg id "$id" --arg status "$1" --arg reason "$2" --arg evidence "$3" --argjson lines "$lines" \
    '{id: $id, status: $status, reason: $reason, evidence: $evidence[0:3000], lines: $lines}' > verdict.json
  echo "status=$1" >> "$out"
  echo "verdict: $1 ($2)"
}

# copy_tree slim|full : the workspace without .git and node_modules (linked).
copy_tree() {
  local dst
  dst=$(mktemp -d)
  if [ "$1" = slim ]; then
    rsync -a --exclude .git --exclude node_modules --include "$test_dir/***" --exclude '*.test.ts' --exclude '*.test.tsx' ./ "$dst/"
  else
    rsync -a --exclude .git --exclude node_modules ./ "$dst/"
  fi
  ln -s "$PWD/node_modules" "$dst/node_modules"
  echo "$dst"
}

run_repro() {
  local dst rc=0
  dst=$(copy_tree slim)
  (cd "$dst" && timeout 5m npx claude plugin test . 2>&1) > repro.full.log || rc=$?
  tail -n 400 repro.full.log | cut -c1-400 > repro.log
  rm -f repro.full.log
  return "$rc"
}

if [ "$mode" = repro ]; then
  mv -f verdict.json verdict.raw.json 2>/dev/null || true
  status=$(jq -r 'if (.status | IN("confirmed", "refuted", "needs-human")) then .status else "invalid" end' verdict.raw.json 2>/dev/null || echo invalid)
  evidence=$(jq -r '(.evidence // "") | tostring | .[0:1500]' verdict.raw.json 2>/dev/null || true)
  : > repro.log
  case "$status" in
    invalid) verdict needs-human "the agent wrote no valid verdict.json" "" ;;
    refuted | needs-human) verdict "$status" "the agent's verdict" "$evidence" ;;
    confirmed)
      [ -f "$test_dir/repro.test.ts" ] || { verdict needs-human "confirmed without a reproduction test" "$evidence"; exit 0; }
      rc=0
      run_repro || rc=$?
      # A real failure: non-zero exit, a failed test (not "the file did not load")
      # and an assertion error in the output.
      if [ "$rc" -ne 0 ] && grep -E '^\(fail\) ' repro.log | grep -qv 'the file did not load' && grep -q 'AssertionError' repro.log; then
        verdict confirmed "the reproduction test fails on current main" "$evidence
--- repro.log (tail)
$(tail -n 40 repro.log)"
      elif [ "$rc" -eq 0 ]; then
        verdict needs-human "the reproduction test passes on current main" "$evidence"
      else
        verdict needs-human "the reproduction test fails for another reason than an assertion" "$evidence
--- repro.log (tail)
$(tail -n 40 repro.log)"
      fi ;;
  esac
  exit 0
fi

# fixed: only a confirmed verdict gets here.
[ "$(jq -r .status verdict.json)" = confirmed ] || exit 0
cp verdict.json verdict.raw.json
evidence=$(jq -r .evidence verdict.json)
# Something besides the reproduction must have changed.
changed=$(git -c core.hooksPath=/dev/null -c core.fsmonitor=false status --porcelain --untracked-files=all | grep -v -E "^.. (tests/night-fix/$id/|verdict|finding\.json|repro\.|fixed-tests\.log|agent-|fix\.patch)" || true)
[ -n "$changed" ] || { verdict needs-human "the fixer proposed no change" "$evidence"; exit 0; }
# The required check includes prettier: format the reproduction test (no semantics).
npx prettier --write "$test_dir" > /dev/null || true
rc=0
run_repro || rc=$?
[ "$rc" -eq 0 ] || { verdict needs-human "fix does not make the reproduction pass" "$evidence
--- repro.log (tail)
$(tail -n 40 repro.log)"; exit 0; }
dst=$(copy_tree full)
rc=0
(cd "$dst" && timeout 20m npm run check 2>&1) > fixed-tests.log || rc=$?
[ "$rc" -eq 0 ] || { tail -n 400 fixed-tests.log | cut -c1-400 > repro.log; verdict needs-human "fix fails check" "$evidence
--- npm run check (tail)
$(tail -n 40 repro.log)"; exit 0; }
verdict confirmed "the reproduction passes with the fix, npm run check is green" "$evidence"
