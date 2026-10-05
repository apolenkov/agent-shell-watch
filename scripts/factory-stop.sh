#!/usr/bin/env bash
# The one stop switch of the factory (TASK-282.08, docs/adr/0001-night-factory-autonomy.md).
#   scripts/factory-stop.sh <repo>|--all [--resume] [--dry-run] [--keep-runs] [--revoke-secret]
# <repo> is a name under apolenkov/; --all is every repository that has ci-autofix.yml on main.
# Stop (default) does, per repository, everything the factory does by itself:
#   1. disables its workflows: ci-autofix, night-review, night-fix and dependabot-automerge;
#   2. switches auto-merge off on the open PRs the factory armed or may arm: Dependabot's, those
#      labelled night-fix or autofix (an armed PR would otherwise merge on green with the workflows off);
#   3. cancels the queued and running runs of those workflows (--keep-runs leaves them) and waits
#      until they have ended: a cancel is asked, not instant (a running scan took 80 seconds);
#   4. with --revoke-secret also deletes OCR_LLM_AUTH_TOKEN (environment ci, repository Actions
#      and Dependabot stores): every LLM job then fails by itself, but only the owner can put the
#      token back (copy the key, then ~/.local/bin/set-ocr-secret.sh apolenkov/<repo>);
#   5. reads everything back and exits 1 unless nothing is enabled, nothing is armed and no run
#      is left (STOP_WAIT seconds, default 240, are given to the cancelled runs).
# It does not touch ci, codeql, scorecard or release (release-please): the checks and releases are
# not the factory. --resume enables the workflows again and lists the open factory PRs that
# have no auto-merge now (re-arm: gh pr merge --auto --squash <n>); a deleted secret stays deleted.
set -euo pipefail

OWNER=apolenkov
WORKFLOWS=(ci-autofix night-review night-fix dependabot-automerge)
STOP_WAIT=${STOP_WAIT:-240}
LIVE=(queued in_progress waiting)
target=${1:?usage: factory-stop.sh <repo>|--all [--resume] [--dry-run] [--keep-runs] [--revoke-secret]}
shift || true
resume=0 dry=0 keep=0 revoke=0
for a in "$@"; do
  case "$a" in
    --resume) resume=1 ;; --dry-run) dry=1 ;; --keep-runs) keep=1 ;; --revoke-secret) revoke=1 ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done
[ "$resume" = 0 ] || [ "$revoke" = 0 ] || { echo "--resume and --revoke-secret do not go together" >&2; exit 2; }

say() { echo "$1"; }
act() { if [ "$dry" = 1 ]; then echo "  (dry run) $*"; else "$@"; fi; }

repos=()
if [ "$target" = --all ]; then
  while read -r r; do
    gh api "repos/$OWNER/$r/contents/.github/workflows/ci-autofix.yml" --jq .name >/dev/null 2>&1 && repos+=("$r")
  done < <(gh repo list "$OWNER" --limit 100 --json name,isArchived --jq '.[] | select(.isArchived | not) | .name')
else
  repos=("$target")
fi
[ "${#repos[@]}" -gt 0 ] || { echo "no repository with ci-autofix.yml" >&2; exit 2; }

problems=0
for repo in "${repos[@]}"; do
  R="$OWNER/$repo"
  say "== $R ($([ "$resume" = 1 ] && echo resume || echo stop))"
  # name -> state of each factory workflow that exists in this repository
  states=$(gh workflow list -R "$R" --all --json path,state --jq '.[] | [(.path | sub("^.github/workflows/"; "") | sub("\\.ya?ml$"; "")), .state] | @tsv')
  for w in "${WORKFLOWS[@]}"; do
    state=$(awk -F'\t' -v w="$w" '$1 == w {print $2}' <<<"$states")
    [ -n "$state" ] || continue
    if [ "$resume" = 1 ]; then
      [ "$state" = active ] || { say "  enable $w"; act gh workflow enable "$w.yml" -R "$R"; }
    else
      [ "$state" != active ] || { say "  disable $w"; act gh workflow disable "$w.yml" -R "$R"; }
    fi
  done

  # Open PRs of the factory: Dependabot's, night-fix, autofix.
  prs=$({ gh pr list -R "$R" --state open --author app/dependabot --json number,autoMergeRequest
          gh pr list -R "$R" --state open --label night-fix --json number,autoMergeRequest
          gh pr list -R "$R" --state open --label autofix --json number,autoMergeRequest; } | jq -s 'add | unique_by(.number)')
  if [ "$resume" = 1 ]; then
    unarmed=$(jq -r '.[] | select(.autoMergeRequest == null) | .number' <<<"$prs" | tr '\n' ' ')
    [ -z "$unarmed" ] || say "  open factory PRs without auto-merge: $unarmed (re-arm: gh pr merge --auto --squash <n> -R $R)"
  else
    for n in $(jq -r '.[] | select(.autoMergeRequest != null) | .number' <<<"$prs"); do
      say "  auto-merge off on #$n"; act gh pr merge "$n" -R "$R" --disable-auto
    done
    if [ "$keep" = 0 ]; then
      for w in "${WORKFLOWS[@]}"; do
        for st in "${LIVE[@]}"; do
          for id in $(gh run list -R "$R" -w "$w.yml" --status "$st" --json databaseId --jq '.[].databaseId' 2>/dev/null || true); do
            say "  cancel run $id ($w, $st)"; act gh run cancel "$id" -R "$R"
          done
        done
      done
    fi
    if [ "$revoke" = 1 ]; then
      say "  delete OCR_LLM_AUTH_TOKEN (only the owner can put it back)"
      act gh secret delete OCR_LLM_AUTH_TOKEN --env ci -R "$R" 2>/dev/null || true
      act gh secret delete OCR_LLM_AUTH_TOKEN -R "$R" 2>/dev/null || true
      act gh secret delete OCR_LLM_AUTH_TOKEN --app dependabot -R "$R" 2>/dev/null || true
    fi
  fi

  # Read back.
  [ "$dry" = 0 ] || continue
  states=$(gh workflow list -R "$R" --all --json path,state --jq '.[] | [(.path | sub("^.github/workflows/"; "") | sub("\\.ya?ml$"; "")), .state] | @tsv')
  for w in "${WORKFLOWS[@]}"; do
    state=$(awk -F'\t' -v w="$w" '$1 == w {print $2}' <<<"$states")
    [ -n "$state" ] || continue
    if [ "$resume" = 1 ]; then [ "$state" = active ] || { say "  PROBLEM: $w is $state"; problems=$((problems + 1)); }
    else [ "$state" != active ] || { say "  PROBLEM: $w is still $state"; problems=$((problems + 1)); }; fi
  done
  if [ "$resume" = 0 ] && [ "$keep" = 0 ]; then
    left=1
    for _ in $(seq $((STOP_WAIT / 5 + 1))); do
      left=0
      for w in "${WORKFLOWS[@]}"; do
        for st in "${LIVE[@]}"; do
          left=$((left + $(gh run list -R "$R" -w "$w.yml" --status "$st" --json databaseId --jq length 2>/dev/null || echo 0)))
        done
      done
      [ "$left" -eq 0 ] && break
      sleep 5
    done
    [ "$left" -eq 0 ] || { say "  PROBLEM: $left factory run(s) still not ended after ${STOP_WAIT}s (gh run cancel --force <id>)"; problems=$((problems + 1)); }
  fi
  if [ "$resume" = 0 ]; then
    armed=$(gh pr list -R "$R" --state open --json number,autoMergeRequest,author,labels --jq '[.[] | select(.autoMergeRequest != null and ((.author.login | test("dependabot")) or ([.labels[].name] | any(. == "night-fix" or . == "autofix"))))] | length')
    [ "$armed" = 0 ] || { say "  PROBLEM: $armed factory PR(s) still have auto-merge on"; problems=$((problems + 1)); }
  fi
done

if [ "$dry" = 1 ]; then echo "dry run: nothing changed"; exit 0; fi
if [ "$problems" -gt 0 ]; then echo "NOT CLEAN: $problems problem(s)" >&2; exit 1; fi
if [ "$resume" = 1 ]; then echo "RESUMED"; else echo "STOPPED"; fi
