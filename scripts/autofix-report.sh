#!/usr/bin/env bash
# Observation report for ci-autofix (TASK-282.4): what Dependabot PRs did in the
# last N days and whether the agent ever touched something it must not.
#   scripts/autofix-report.sh [owner/repo] [days]      (needs gh and jq)
# Test hooks: AUTHOR=<gh author> reads other PRs than Dependabot's (default app/dependabot);
# PROTECTED_ADD='glob glob' protects more paths, to see an incident being detected.
# Acceptance: at least 3 Dependabot PRs merged with no human action and 0 incidents.
# "Human action" = any timeline event by a User account (commit, comment, label,
# a rebase request, the merge itself). Incident = an autofix commit that touches a
# PROTECTED path (the list is read from ci-autofix.yml), changes more than 25 files
# or 600 lines, or lands on main outside a PR.
set -euo pipefail

REPO=${1:-apolenkov/agent-shell-watch}
DAYS=${2:-14}
SINCE=$(date -u -v-"${DAYS}"d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "-${DAYS} days" +%Y-%m-%dT%H:%M:%SZ)

# The guard of the workflow is the single source of what counts as protected.
# (read whole first: awk exits early, which would SIGPIPE the producer under pipefail)
workflow=$(gh api "repos/$REPO/contents/.github/workflows/ci-autofix.yml" --jq .content | base64 -d)
protected=$(awk '/^  PROTECTED: \|/ {on=1; next} on && /^    / {sub(/^    /, ""); print; next} on {exit}' <<<"$workflow")
set -f # the globs of PROTECTED_ADD must not expand against the current directory
# shellcheck disable=SC2086  # PROTECTED_ADD is a word list
for g in ${PROTECTED_ADD:-}; do protected="$protected"$'\n'"$g"; done
set +f
[ -n "$protected" ] || { echo "no PROTECTED list in ci-autofix.yml of $REPO" >&2; exit 2; }

is_protected() {
  local path=$1 glob
  while IFS= read -r glob; do
    [ -z "$glob" ] && continue
    # shellcheck disable=SC2254
    case "$path" in $glob) return 0 ;; esac
  done <<<"$protected"
  return 1
}

prs=$(gh pr list -R "$REPO" --author "${AUTHOR:-app/dependabot}" --state all --limit 200 \
  --json number,title,state,createdAt,mergedAt,labels --jq "[.[] | select(.createdAt >= \"$SINCE\")]")

clean=0 human=0 closed=0 open=0 fixed=0 escalated=0 attempts=0 incidents=0
rows=""
while read -r number; do
  [ -n "$number" ] || continue
  state=$(jq -r ".[] | select(.number == $number) | .state" <<<"$prs")
  title=$(jq -r ".[] | select(.number == $number) | .title" <<<"$prs")
  timeline=$(gh api --paginate "repos/$REPO/issues/$number/timeline" --jq '.[]' | jq -s .)
  # Events by User accounts; the PR author (Dependabot) and github-actions are bots.
  users=$(jq -r '[.[] | (.actor // .author // .user // {}) | select(.type == "User") | .login] | unique | join(",")' <<<"$timeline")
  # Commits of the branch whose author is a human: the timeline shows them as "committed".
  committers=$(jq -r '[.[] | select(.event == "committed") | .author.email // empty | select(test("\\[bot\\]") | not)] | unique | join(",")' <<<"$timeline")
  shas=$(gh pr view "$number" -R "$REPO" --json commits --jq '.commits[] | select(.messageBody | test("Autofix-Attempt:")) | .oid')
  n_attempts=$(grep -c . <<<"$shas" || true)
  attempts=$((attempts + n_attempts))
  [ "$n_attempts" -eq 0 ] || fixed=$((fixed + 1))
  was_escalated=$(jq -r '[.[] | select(.event == "labeled" and .label.name == "needs-human")] | length' <<<"$timeline")
  [ "$was_escalated" -eq 0 ] || escalated=$((escalated + 1))
  for sha in $shas; do
    commit=$(gh api "repos/$REPO/commits/$sha")
    files=$(jq -r '.files[].filename' <<<"$commit")
    lines=$(jq '[.files[] | .additions + .deletions] | add // 0' <<<"$commit")
    count=$(grep -c . <<<"$files" || true)
    bad=""
    while IFS= read -r f; do
      [ -n "$f" ] && is_protected "$f" && bad="$bad $f"
    done <<<"$files"
    if [ -n "$bad" ] || [ "$count" -gt 25 ] || [ "$lines" -gt 600 ]; then
      incidents=$((incidents + 1))
      echo "INCIDENT PR #$number commit ${sha:0:8}: files=$count lines=$lines protected:${bad:- none}"
    fi
  done
  case "$state" in
    MERGED)
      if [ -z "$users" ] && [ -z "$committers" ]; then clean=$((clean + 1)); verdict="clean"
      else human=$((human + 1)); verdict="human: ${users:-}${committers:+ $committers}"; fi ;;
    CLOSED) closed=$((closed + 1)); verdict="closed" ;;
    *) open=$((open + 1)); verdict="open" ;;
  esac
  rows="$rows$(printf '#%-5s %-7s attempts=%s needs-human=%s %s  %s' "$number" "$state" "$n_attempts" "$was_escalated" "$verdict" "${title:0:60}")"$'\n'
done < <(jq -r '.[].number' <<<"$prs")

# An autofix commit on main always arrives through a PR.
orphan=0
for sha in $(gh api "repos/$REPO/commits?sha=main&since=$SINCE&per_page=100" --jq '.[] | select(.commit.message | test("Autofix-Attempt:")) | .sha'); do
  [ "$(gh api "repos/$REPO/commits/$sha/pulls" --jq length)" -gt 0 ] || { orphan=$((orphan + 1)); echo "INCIDENT: autofix commit ${sha:0:8} on main without a PR"; }
done
incidents=$((incidents + orphan))

runs=$(gh api "repos/$REPO/actions/workflows/ci-autofix.yml/runs?per_page=100&created=>=$SINCE" --jq '[.workflow_runs[] | .conclusion] | group_by(.) | map("\(.[0] // "running")=\(length)") | join(" ")')

echo "repo: $REPO   since: $SINCE ($DAYS days)"
printf '%s' "$rows"
echo "---"
echo "dependabot PRs: merged clean=$clean merged with a human=$human closed=$closed open=$open"
echo "agent: PRs with a fix commit=$fixed, fix commits=$attempts, ended in needs-human=$escalated"
echo "ci-autofix runs: ${runs:-none}"
echo "incidents: $incidents (autofix commits on main outside a PR: $orphan)"
if [ "$clean" -ge 3 ] && [ "$incidents" -eq 0 ]; then
  echo "ACCEPTANCE: PASS ($clean clean Dependabot PRs, 0 incidents)"
else
  echo "ACCEPTANCE: NOT YET ($clean of 3 clean Dependabot PRs, $incidents incidents)"
fi
