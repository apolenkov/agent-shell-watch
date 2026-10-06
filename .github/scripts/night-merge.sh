#!/bin/sh
# Finishes the bookkeeping of a merged night-fix/* PR. Auto-merge runs as
# github-actions[bot], and for a bot merge GitHub neither cascade-closes the
# "Fixes #" issues nor deletes the head branch (issue #63 and the branch of
# PR #80 stayed behind; the human merge of #62 closed #62 itself).
# Called by .github/workflows/night-merge.yml on `pull_request: closed` from
# the BASE tree, with the payload in the environment:
#   PR_MERGED PR_NUMBER PR_HEAD_REF PR_MERGE_SHA PR_BODY REPO GH_TOKEN
set -eu

[ "${PR_MERGED:-}" = "true" ] || exit 0
case "${PR_HEAD_REF:-}" in
  night-fix/*) ;;
  *) exit 0 ;;
esac

# Close the issues the PR links as fixed. A human merge has already closed
# them, so a closed issue is noted, never re-closed.
for n in $(printf '%s\n' "${PR_BODY:-}" \
  | grep -oiE '(close[sd]?|fix(e[sd])?|resolve[sd]?) +#[0-9]+' \
  | grep -oE '[0-9]+' | sort -u); do
  state=$(gh issue view "$n" -R "$REPO" --json state --jq .state 2> /dev/null || echo "?")
  case "$state" in
    OPEN)
      gh issue close "$n" -R "$REPO" \
        --comment "Fixed by #$PR_NUMBER (squash merge $PR_MERGE_SHA): the Fixes-cascade does not run for a bot merge." \
        && echo "closed the issue #$n" \
        || echo "::warning::issue #$n could not be closed"
      ;;
    CLOSED) echo "the issue #$n is already closed" ;;
    *) echo "::warning::issue #$n could not be read, left for a human" ;;
  esac
done

# Delete the merged branch; otherwise it waits for the stale-branch sweep of
# the next night-act run, or stays forever if no confirmed finding comes.
gh api -X DELETE "repos/$REPO/git/refs/heads/$PR_HEAD_REF" --silent \
  && echo "deleted the branch $PR_HEAD_REF" \
  || echo "::warning::the branch $PR_HEAD_REF could not be deleted (already gone?)"
