#!/usr/bin/env bash
# Roll ci-autofix.yml and night-review.yml out to another repository (TASK-282.4).
#   scripts/rollout-autofix.sh <repo> [--apply|--cleanup]   repo = a name under apolenkov/
# Default is a dry run: preflight checks of the target, the two workflows rendered from
# THIS repository's main with the per-repo settings of scripts/rollout/<repo>.conf, and
# actionlint on both. --apply then labels the target, opens ONE PR there (branch
# ci/autofix-rollout, worktree of ~/work/<repo>, the repo's own hooks run) and turns on
# auto-merge. Run --apply on one repository first and watch it before the rest.
# --cleanup, after the PR merged, removes the worktree and the branch. scripts/rollout-all.sh
# drives all targets in turn.
# The first --apply has not been run yet: the pilot has been observed for 0 of 14 days.
# shellcheck disable=SC2015,SC2016  # A && B || C is meant (fail never fails); the jq/shell text is literal
set -euo pipefail

repo=${1:?usage: rollout-autofix.sh <repo> [--apply]}
apply=${2:-}
OWNER=apolenkov
here=$(cd "$(dirname "$0")" && pwd)
conf="$here/rollout/$repo.conf"
[ -f "$conf" ] || { echo "no $conf" >&2; exit 2; }
# CI_NAME FIXABLE_RE CODEQL_NAME NODE_LINE PROTECTED_EXTRA COMMITLINT HOLD CLONE (dir under ~/work, default the repo name)
CLONE='' CODEQL_NAME='' PROTECTED_EXTRA='' COMMITLINT='' HOLD=''
# shellcheck disable=SC1090
source "$conf"
: "${CI_NAME:?}" "${FIXABLE_RE:?}" "${NODE_LINE:?}"

if [ "$apply" = --cleanup ]; then
  clone="$HOME/work/${CLONE:-$repo}"
  git -C "$clone" worktree remove --force "$clone/../$repo-autofix-rollout" 2>/dev/null || true
  git -C "$clone" branch -D ci/autofix-rollout 2>/dev/null || true
  git -C "$clone" push -q origin --delete ci/autofix-rollout 2>/dev/null || true
  git -C "$clone" worktree prune
  echo "cleaned $repo"; exit 0
fi

problems=0
note() { echo "$1"; }
fail() { echo "PROBLEM: $1"; problems=$((problems + 1)); }

# --- preflight: what the workflows need from the target -------------------------------
note "== preflight $OWNER/$repo"
[ -z "$HOLD" ] || fail "on hold: $HOLD"
# The token may sit in environment ci or at repository level; a job with `environment: ci` sees both.
env_secrets=$(gh api "repos/$OWNER/$repo/environments/ci/secrets" --jq '[.secrets[].name] | join(",")' 2>/dev/null || true)
repo_secrets=$(gh api "repos/$OWNER/$repo/actions/secrets" --jq '[.secrets[].name] | join(",")' 2>/dev/null || true)
case ",$env_secrets,$repo_secrets," in *,OCR_LLM_AUTH_TOKEN,*) note "ok  OCR_LLM_AUTH_TOKEN is set (environment ci or repository)" ;; *) fail "OCR_LLM_AUTH_TOKEN is missing in environment ci and in the repository secrets (only the owner has the token)" ;; esac
# GraphQL, not REST: the REST sub-endpoint answers 1 for a branch that has no review rule at all.
reviews=$(gh api graphql -f query="query{repository(owner:\"$OWNER\",name:\"$repo\"){branchProtectionRules(first:10){nodes{pattern requiresApprovingReviews requiredApprovingReviewCount}}}}" \
  --jq '.data.repository.branchProtectionRules.nodes[] | select(.pattern == "main") | if .requiresApprovingReviews then (.requiredApprovingReviewCount // 1) else 0 end')
[ "$reviews" = 0 ] && note "ok  no required approving review" || fail "main requires $reviews approving review(s): Dependabot auto-merge and the bot's PRs would wait for a person"
auto=$(gh api "repos/$OWNER/$repo" --jq .allow_auto_merge)
[ "$auto" = true ] && note "ok  auto-merge allowed" || fail "auto-merge is not allowed on the repository"
wf_names=$(gh api "repos/$OWNER/$repo/actions/workflows" --jq '[.workflows[].name] | join("|")')
case "|$wf_names|" in *"|$CI_NAME|"*) note "ok  workflow \"$CI_NAME\" exists" ;; *) fail "no workflow named \"$CI_NAME\" (have: $wf_names)" ;; esac
[ -z "$CODEQL_NAME" ] || case "|$wf_names|" in *"|$CODEQL_NAME|"*) ;; *) fail "no workflow named \"$CODEQL_NAME\"" ;; esac
gh api "repos/$OWNER/$repo/contents/.github/dependabot.yml" --jq .name >/dev/null 2>&1 && note "ok  dependabot.yml present" || fail "no .github/dependabot.yml"
note "required checks: $(gh api "repos/$OWNER/$repo/branches/main/protection" --jq '[.required_status_checks.contexts[]] | join(", ")')"

# --- render ----------------------------------------------------------------------------
out=$(mktemp -d)
trap '[ -n "${KEEP:-}" ] || rm -rf "$out"' EXIT # KEEP=1 leaves the rendered files to read
for f in ci-autofix night-review; do
  gh api "repos/$OWNER/agent-shell-watch/contents/.github/workflows/$f.yml" --jq .content | base64 -d >"$out/$f.yml"
done

# replace_once <file> <old> <new>: literal, and the old text must occur exactly once.
replace_once() {
  local n
  n=$(OLD=$2 awk 'BEGIN {o = ENVIRON["OLD"]} index($0, o) {c++} END {print c + 0}' "$1")
  [ "$n" = 1 ] || { echo "render: '$2' occurs $n times in $1, expected 1" >&2; exit 3; }
  OLD=$2 NEW=$3 awk 'BEGIN {o = ENVIRON["OLD"]; n = ENVIRON["NEW"]} {i = index($0, o); if (i) $0 = substr($0, 1, i - 1) n substr($0, i + length(o)); print}' "$1" >"$1.new"
  mv "$1.new" "$1"
}

a="$out/ci-autofix.yml" n="$out/night-review.yml"
replace_once "$a" 'workflows: [ci]' "workflows: [$CI_NAME]"
replace_once "$a" '.name == "ci" and' ".name == \"$CI_NAME\" and"
replace_once "$a" 'select(.name == "ci")' "select(.name == \"$CI_NAME\")"
codeql_test=''
[ -z "$CODEQL_NAME" ] || codeql_test=" and (\$n | index(\"$CODEQL_NAME\")) != null"
replace_once "$a" '($n | index("ci")) != null and ($n | index("codeql")) != null and all(' "(\$n | index(\"$CI_NAME\")) != null${codeql_test} and all("
# Only the fixable job(s) may have failed; a red gitleaks or release job is for a person.
replace_once "$a" '[ "$failed" = check ] || { echo "failed jobs: $failed; only check is fixable"; exit 0; }' \
  "bad=\$(tr ',' '\\n' <<<\"\$failed\" | grep -vE '^(${FIXABLE_RE})\$' || true)
          { [ -n \"\$failed\" ] && [ -z \"\$bad\" ]; } || { echo \"failed jobs: \$failed; only the main check is fixable\"; exit 0; }"
if [ -n "$PROTECTED_EXTRA" ]; then
  extra=''
  for g in $PROTECTED_EXTRA; do extra="$extra    $g"$'\n'; done
  replace_once "$a" 'tests/*' "tests/*
${extra%$'\n'}"
fi
replace_once "$n" 'workflows: [ci]' "workflows: [$CI_NAME]"
replace_once "$n" 'node-version-file: .nvmrc' "$NODE_LINE"
(cd "$out" && actionlint ci-autofix.yml night-review.yml) && note "ok  actionlint on both rendered workflows" || fail "actionlint rejected a rendered workflow"
note "rendered into $out (KEEP=1 keeps it)"

if [ "$problems" -gt 0 ]; then echo "$problems problem(s): not applying"; exit 1; fi
[ "$apply" = --apply ] || { echo "dry run clean. Re-run with --apply to open the PR."; exit 0; }

# --- apply -----------------------------------------------------------------------------
clone="$HOME/work/${CLONE:-$repo}"
[ -d "$clone/.git" ] || { echo "no local clone $clone" >&2; exit 4; }
for l in needs-human autofix; do
  gh label create "$l" -R "$OWNER/$repo" --color "$([ "$l" = needs-human ] && echo D93F0B || echo 0E8A16)" \
    --description "$([ "$l" = needs-human ] && echo 'ci-autofix gave up: a person has to look' || echo 'Let ci-autofix repair this PR')" 2>/dev/null || true
done
git -C "$clone" fetch -q origin
wt="$clone/../$repo-autofix-rollout"
git -C "$clone" worktree add -q "$wt" -b ci/autofix-rollout origin/main
cp "$out/ci-autofix.yml" "$out/night-review.yml" "$wt/.github/workflows/"
if [ -n "$COMMITLINT" ] && ! grep -q 'Signed-off-by: dependabot' "$wt/$COMMITLINT"; then
  # Dependabot writes "chore(deps-dev): Bump ..." that the scope and case rules reject.
  awk '{print} /^  extends: \[.*\],?$/ && !d {print "  ignores: [\n    (message: string): boolean =>\n      message.includes(\"Signed-off-by: dependabot[bot]\"),\n  ],"; d=1}' "$wt/$COMMITLINT" >"$wt/$COMMITLINT.new"
  mv "$wt/$COMMITLINT.new" "$wt/$COMMITLINT"
fi
# The repo's hooks (commitlint, full check before push) need its dependencies in the worktree.
(cd "$wt" && npm ci --ignore-scripts --no-audit --no-fund >/dev/null \
  && { [ ! -f node_modules/@anthropic-ai/claude-code/install.cjs ] || node node_modules/@anthropic-ai/claude-code/install.cjs >/dev/null; })
git -C "$wt" add .github/workflows/ci-autofix.yml .github/workflows/night-review.yml ${COMMITLINT:+"$COMMITLINT"}
git -C "$wt" commit -q -m "ci(repo): add ci-autofix and night-review" -m "Same workflows as agent-shell-watch (TASK-282), set to this repository's
CI workflow name, fixable job and protected paths." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git -C "$wt" push -q -u origin ci/autofix-rollout
pr=$(gh pr create -R "$OWNER/$repo" --base main --head ci/autofix-rollout --title "ci(repo): add ci-autofix and night-review" \
  --body "ci-autofix (an OpenCode Go agent repairs red Dependabot PRs, two attempts, then needs-human) and night-review, as piloted in agent-shell-watch (TASK-282.2, TASK-282.3).

🤖 Generated with [Claude Code](https://claude.com/claude-code)")
gh pr merge "$pr" --auto --squash
echo "opened $pr with auto-merge on"
