#!/usr/bin/env bash
# The daily watch of the factory (TASK-282, docs/adr/0001-night-factory-autonomy.md): runs
# autofix-report.sh for every repository that has ci-autofix.yml and opens ONE issue here, in the
# repository that runs it, for each incident or suspect it has not reported before.
#   scripts/factory-watch.sh [--dry-run]     (needs gh and jq; env REPO = owner/repo that holds the issues)
# One issue per finding: the title carries a fingerprint of the finding line, and a finding whose
# issue exists in any state (open or closed by the owner) is not reported again. A report that fails
# stops the script (the job goes red); a clean report opens nothing.
set -euo pipefail

OWNER=apolenkov
HERE=$(cd "$(dirname "$0")" && pwd)
HOME_REPO=${REPO:-$OWNER/agent-shell-watch}
dry=0
[ "${1:-}" != --dry-run ] || dry=1
LABEL=factory-incident

if [ "$dry" = 0 ]; then
  gh label create "$LABEL" -R "$HOME_REPO" --color B60205 --description "autofix-report found an incident or a suspect" 2>/dev/null || true
fi

opened=0 skipped=0
while read -r name; do
  gh api "repos/$OWNER/$name/contents/.github/workflows/ci-autofix.yml" --jq .name >/dev/null 2>&1 || continue
  report=$("$HERE/autofix-report.sh" "$OWNER/$name" 14) || { echo "report failed for $name" >&2; exit 1; }
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    fp=$(printf '%s %s' "$name" "$line" | shasum -a 256 | cut -c1-12)
    title="Factory ${line%% *} in $name [$fp]"
    if [ -n "$(gh issue list -R "$HOME_REPO" --state all --label "$LABEL" --search "\"[$fp]\" in:title" --json number --jq '.[0].number // empty')" ]; then
      skipped=$((skipped + 1)); echo "known: $title"; continue
    fi
    # shellcheck disable=SC2016  # the backticks are literal Markdown
    body=$(printf 'autofix-report.sh found this in %s/%s (window of 14 days):\n\n```\n%s\n```\n\nA person has to look. Close this issue when handled; it will not be reported again.\nStop everything with `scripts/factory-stop.sh %s`.\n' "$OWNER" "$name" "$line" "$name")
    if [ "$dry" = 1 ]; then echo "would open: $title"; else
      gh issue create -R "$HOME_REPO" --title "$title" --label "$LABEL" --body "$body" >/dev/null && echo "opened: $title"
    fi
    opened=$((opened + 1))
  done < <(grep -E '^(INCIDENT|SUSPECT) ' <<<"$report" || true)
done < <(gh repo list "$OWNER" --limit 100 --json name,isArchived --jq '.[] | select(.isArchived | not) | .name')
echo "watch done: $opened new, $skipped already known"
