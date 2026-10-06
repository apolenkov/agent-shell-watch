#!/usr/bin/env bash
# The write side of night-fix: for every selected finding a PR (confirmed, fix
# verified, patch accepted by the guard) or a comment line, an issue for every
# confirmed or needs-human finding (never for a refuted one or an infrastructure
# failure; one issue per fingerprint, the PR says "Fixes #N"), then ONE comment on the
# tracking issue and a sweep that closes the issues of findings the scan no longer
# has. Runs without the LLM token.
#   usage: night-act.sh <work dir>
# work dir: findings.json (selected findings), fps.json (all fingerprints of the scan
# and whether it was complete) and results/night-<id>/ (the artifact of
# each work leg: verdict.json, fix.patch, ...). Env: GH_TOKEN REPO SHA RUN_URL
# SCAN_RUN_URL IDS (space separated 12-hex ids). Must run from a copy of the scripts
# outside the checkout: the guard applies a patch to the tree.
set -euo pipefail

work=${1:?work dir}
here=$(cd "$(dirname "$0")" && pwd)
out="$work/outcomes"
mkdir -p "$out"

# fence <text> : the text in a fenced block that the text cannot close, "@" neutralized.
fence() {
  local text=${1//@/@$'\xe2\x80\x8b'} f='```'
  text=${text:0:1500}
  while [[ $text == *"$f"* ]]; do f+='`'; done
  printf '%stext\n%s\n%s\n' "$f" "$text" "$f"
}

# outcome <id> <status> <reason> <evidence> [pr] : the record the report reads.
outcome() {
  jq -n --arg id "$1" --arg status "$2" --arg reason "$3" --arg evidence "$4" --arg pr "${5:-}" \
    '{id: $id, status: $status, reason: $reason, evidence: $evidence, pr: (if $pr == "" then null else $pr end)}' > "$out/$1.json"
  echo "finding $1: $2 ($3)"
  if [ "$2" = needs-human ] && ! infra "$3"; then
    issue_for "$1" needs-human "$4" > /dev/null || echo "::warning::no issue for $1"
  fi
}

# approve_and_watch <sha> <branch> : as the push job of ci-autofix.yml (copied).
approve_and_watch() {
  local sha=$1 branch=$2 runs id ready=false ci_run
  for _ in $(seq 18); do
    runs=$(gh api "repos/$REPO/actions/runs?head_sha=$sha&event=pull_request" --jq '.workflow_runs')
    for id in $(jq -r '.[] | select(.conclusion == "action_required") | .id' <<<"$runs"); do
      gh api -X POST "repos/$REPO/actions/runs/$id/approve" --silent || true
    done
    if jq -e '[.[].name] as $n | ($n | index("ci")) != null and ($n | index("codeql")) != null and all(.[]; .conclusion != "action_required")' <<<"$runs" > /dev/null; then
      ready=true
      break
    fi
    sleep 10
  done
  [ "$ready" = true ] || { echo "the checks of $sha could not be approved"; return 0; }
  ci_run=$(gh api "repos/$REPO/actions/runs?head_sha=$sha&event=pull_request" --jq '[.workflow_runs[] | select(.name == "ci")] | sort_by(.created_at) | last | .id')
  if timeout 20m gh run watch "$ci_run" -R "$REPO" --exit-status > /dev/null; then
    echo "ci is green on $sha"
  else
    gh workflow run ci-autofix.yml -R "$REPO" -f run_id="$ci_run" -f branch="$branch" -f sha="$sha"
  fi
}

gh label create night-fix -R "$REPO" --color 5319e7 --description "fix of a confirmed night review finding" 2> /dev/null || true
gh label create needs-human -R "$REPO" --color d93f0b --description "a person has to look" 2> /dev/null || true
gh label create night-review -R "$REPO" --color 0e8a16 --description "night review findings" 2> /dev/null || true
gh label create night-finding -R "$REPO" --color b60205 --description "a finding of the night review scan" 2> /dev/null || true
gh label create ocr-scan -R "$REPO" --color 1d76db --description "source: ocr scan" 2> /dev/null || true
gh label create scan-closed -R "$REPO" --color ededed --description "closed because the scan no longer reports it" 2> /dev/null || true
gh label create severity:critical -R "$REPO" --color b60205 2> /dev/null || true
gh label create severity:high -R "$REPO" --color d93f0b 2> /dev/null || true

# The reasons that mean "no verdict", not a finding: no issue for them (keep in step
# with the list in night-report.sh).
infra() {
  case "$1" in
    "the verification did not finish" | "the agent wrote no valid verdict.json" | "the agent ran out of steps" | "the patch does not apply") return 0 ;;
  esac
  return 1
}

# The issues of findings, by the marker on the first line of the body (not --search:
# its index lags). Re-read after the loop for the sweep.
issues_of() {
  gh issue list -R "$REPO" --label night-finding --state all --limit 500 --json number,state,body,labels
}
issues=$(issues_of)

# issue_for <id> <status> <evidence> : the number of the issue of this finding; created
# when there is none (title generic from the sanitized path, finding text only fenced),
# refreshed when open, left alone when closed. Prints the number.
issue_for() {
  local id=$1 st=$2 ev=$3 f path sev lines tail_path n labels
  f=$(jq -c --arg id "$id" '.[] | select(.id == $id)' "$work/findings.json")
  path=$(jq -r .path <<<"$f")
  sev=$(jq -r .severity <<<"$f")
  [[ $sev == critical || $sev == high ]] || sev=high
  lines="$(jq -r .start_line <<<"$f")-$(jq -r .end_line <<<"$f")"
  tail_path=$(printf '%s' "$path" | tail -c 50 | tr -c 'A-Za-z0-9._/-' '_')
  {
    echo "<!-- night-fp: $id -->"
    echo "A finding of the night review scan, verdict of night-fix: **$st**."
    echo
    echo "- severity: $sev"
    echo "- location: \`$path:$lines\`"
    echo "- scan: $SCAN_RUN_URL"
    echo "- this run: $RUN_URL"
    echo
    echo "Finding:"
    echo
    fence "$(jq -r .content <<<"$f")"
    echo
    echo "Evidence (data from the verifier agent):"
    echo
    fence "$ev"
  } > "$work/issue-body.md"
  n=$(jq -r --arg m "<!-- night-fp: $id -->" '[.[] | select(.body | startswith($m))] | first | .number // empty' <<<"$issues")
  if [ -z "$n" ]; then
    labels="night-finding,ocr-scan,severity:$sev"
    [ "$st" != needs-human ] || labels+=",needs-human"
    url=$(gh issue create -R "$REPO" --title "Night review: $sev finding in $tail_path" --body-file "$work/issue-body.md" --label "$labels")
    n=${url##*/}
  elif [ "$(jq -r --argjson n "$n" '.[] | select(.number == $n) | .state' <<<"$issues")" = OPEN ]; then
    gh issue edit "$n" -R "$REPO" --body-file "$work/issue-body.md" > /dev/null
  fi
  echo "$n"
}

# spend : tokens and cost of the verify and fix agents of this run, from their summaries.
spend() {
  cat "$work"/results/night-*/agent-summary.txt "$work"/results/night-*/agent-fix-summary.txt 2> /dev/null \
    | sed -n 's/^spend: //p' | jq -sc 'if length == 0 then "no data" else "\(map(.tokens // 0) | add) tokens, cost \(map(.cost // 0) | add)" end' | tr -d '"'
}

# A merged night-fix PR can leave its branch behind (PR #45 did, although the repository deletes head
# branches on merge): delete the night-fix/* branches that have a PR, none of them open.
for b in $(gh api --paginate "repos/$REPO/git/matching-refs/heads/night-fix/" --jq '.[].ref | ltrimstr("refs/heads/")'); do
  [ "$(gh api -X GET "repos/$REPO/pulls" -f state=all -f head="${REPO%%/*}:$b" --jq length)" -gt 0 ] || continue
  [ "$(gh api -X GET "repos/$REPO/pulls" -f state=open -f head="${REPO%%/*}:$b" --jq length)" -eq 0 ] || continue
  gh api -X DELETE "repos/$REPO/git/refs/heads/$b" --silent && echo "deleted the stale branch $b" || true
done

for id in $IDS; do
  [[ $id =~ ^[0-9a-f]{12}$ ]] || continue
  dir="$work/results/night-$id"
  f=$(jq -c --arg id "$id" '.[] | select(.id == $id)' "$work/findings.json")
  v=$(jq -c '{status: (if (.status | IN("confirmed", "refuted", "needs-human")) then .status else "needs-human" end),
              reason: ((.reason // "") | tostring | .[0:300]), evidence: ((.evidence // "") | tostring | .[0:3000])}' "$dir/verdict.json" 2> /dev/null || true)
  [ -n "$v" ] || { outcome "$id" needs-human "the verification did not finish" ""; continue; }
  status=$(jq -r .status <<<"$v")
  reason=$(jq -r .reason <<<"$v")
  evidence=$(jq -r .evidence <<<"$v")
  if [ "$status" != confirmed ]; then
    outcome "$id" "$status" "$reason" "$evidence"
    continue
  fi
  [ -s "$dir/fix.patch" ] || { outcome "$id" needs-human "confirmed, but no verified patch" "$evidence"; continue; }

  branch="night-fix/$id"
  # main may have moved since the gate: the PR starts from its head now, so it
  # is not BEHIND (strict required checks); a patch that no longer applies stops.
  git fetch -q --no-tags "https://github.com/${REPO}.git" main
  git checkout -q -B "$branch" FETCH_HEAD
  rc=0
  why=$(NIGHT_ID=$id PROTECTED="$PROTECTED"$'\n'"verdict*.json" bash "$here/guard-patch.sh" "$dir/fix.patch") || rc=$?
  if [ "$rc" -ne 0 ]; then
    [ "$rc" -eq 3 ] || why="the guard failed (exit $rc)"
    outcome "$id" needs-human "$why" "$evidence"
    continue
  fi
  path=$(jq -r .path <<<"$f")
  sev=$(jq -r .severity <<<"$f")
  lines="$(jq -r .start_line <<<"$f")-$(jq -r .end_line <<<"$f")"
  # Generic subject from the sanitized path; the finding text never reaches it.
  tail_path=$(printf '%s' "$path" | tail -c 50 | tr -c 'A-Za-z0-9._/-' '_')
  title="fix(agent-shell-watch): fix confirmed night finding in $tail_path"
  git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    commit -q -m "$title" -m "$(printf 'Autofix-Attempt: 1\nAutofix-Run: %s\nNight-Finding: %s' "$RUN_URL" "$id")"
  new_sha=$(git rev-parse HEAD)
  if ! git push "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" "HEAD:refs/heads/$branch"; then
    outcome "$id" needs-human "the branch $branch could not be pushed (it exists?)" "$evidence"
    continue
  fi
  {
    echo "A finding of the night review scan was **confirmed** by a reproduction test that fails on main, and the fix makes it pass."
    echo
    echo "- severity: $sev"
    echo "- location: \`$path:$lines\`"
    echo "- scan: $SCAN_RUN_URL"
    echo "- this run: $RUN_URL"
    echo
    echo "Evidence (data from the verifier agent):"
    echo
    fence "$evidence"
    if issue=$(issue_for "$id" confirmed "$evidence"); then
      echo
      echo "Fixes #$issue"
    fi
  } > "$work/pr-body.md"
  if ! pr=$(gh pr create -R "$REPO" --base main --head "$branch" --title "$title" --body-file "$work/pr-body.md" --label night-fix); then
    outcome "$id" needs-human "the fix was pushed to $branch but the PR could not be opened" "$evidence"
    continue
  fi
  outcome "$id" confirmed "$reason" "$evidence" "$pr"
  gh pr merge "$pr" -R "$REPO" --auto --squash || echo "::warning::auto-merge could not be enabled on $pr"
  approve_and_watch "$new_sha" "$branch"
done
git checkout -q --detach "$SHA"

# One comment per run on the tracking issue (found by label, created if missing).
n=$(gh issue list -R "$REPO" --label night-review --state all --limit 1 --json number --jq '.[0].number // empty')
if [ -z "$n" ]; then
  url=$(gh issue create -R "$REPO" --title "Night review findings" --label night-review \
    --body "Findings of the nightly OCR scan, verified by night-fix: one comment per run.")
  n=${url##*/}
else
  gh issue reopen "$n" -R "$REPO" > /dev/null 2>&1 || true
fi
{
  bash "$here/night-report.sh" "$work/findings.json" "$out" 2> /dev/null || echo "### night-fix run: nothing new to verify"
  echo
  echo "Spend: scan $(jq -r '.scan_tokens // 0' "$work/fps.json" 2> /dev/null) tokens; verify and fix agents: $(spend)."
} > "$work/comment.md"
gh issue comment "$n" -R "$REPO" --body-file "$work/comment.md"

# Sweep: a complete scan that no longer reports a finding closes its issue; a closed one
# (by this sweep only) whose finding is back is reopened.
if [ "$(jq -r '.complete // false' "$work/fps.json" 2> /dev/null)" = true ]; then
  issues=$(issues_of)
  jq -r '.[] | [.number, .state, (.body | capture("^<!-- night-fp: (?<fp>[0-9a-f]{12}) -->").fp // ""), ([.labels[].name] | index("scan-closed") != null)] | @tsv' <<<"$issues" \
    | while IFS=$'\t' read -r num state fp closed; do
      [ -n "$fp" ] || continue
      present=$(jq -r --arg fp "$fp" '.fps | index($fp) != null' "$work/fps.json")
      if [ "$state" = OPEN ] && [ "$present" = false ]; then
        gh issue edit "$num" -R "$REPO" --add-label scan-closed > /dev/null
        gh issue close "$num" -R "$REPO" --reason completed --comment "The finding is not in the complete scan $SCAN_RUN_URL any more." > /dev/null
      elif [ "$state" = CLOSED ] && [ "$closed" = true ] && [ "$present" = true ]; then
        gh issue edit "$num" -R "$REPO" --remove-label scan-closed > /dev/null
        gh issue reopen "$num" -R "$REPO" --comment "The finding is back in the scan $SCAN_RUN_URL." > /dev/null
      fi
    done
fi
