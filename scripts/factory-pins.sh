#!/usr/bin/env bash
# One place to see and move the pins of the factory (TASK-282.09): the opencode version and its
# registry integrity (ci-autofix.yml, night-fix.yml) and the OCR version with the SHA of its action
# (night-review.yml). Dependabot sees none of them: they sit in env values and a comment.
#   scripts/factory-pins.sh                 report: every repository with ci-autofix.yml against the
#                                           latest opencode-linux-x64 and open-code-review; exit 1 on drift
#   scripts/factory-pins.sh --update        one PR per drifting repository (auto-merge on), the pins
#                                           rewritten in place; the files are changed through the
#                                           contents API, the repository's own CI judges the PR
# PINS_REPOS='name name' limits the run to those repositories.
# Test hooks: PINS_OPENCODE=<version> and PINS_OCR_TAG=<tag> stand in for "latest" (a drill moves the
# pins to older real versions and opens the PR). A bump is not tested by anything until it merges (workflow_run reads main): read the changelog of
# the new version first, run the report, then --update. The files are never touched by the
# agent itself: this is the maintainer's command.
set -euo pipefail

OWNER=apolenkov
FILES=(ci-autofix night-review night-fix)
mode=${1:-report}
case "$mode" in report | --update) ;; *) echo "usage: factory-pins.sh [--update]" >&2; exit 2 ;; esac

OC_VER=${PINS_OPENCODE:-$(npm view opencode-linux-x64 version)}
OC_INT=$(npm view "opencode-linux-x64@$OC_VER" dist.integrity)
OCR_TAG=${PINS_OCR_TAG:-$(gh api repos/alibaba/open-code-review/releases/latest --jq .tag_name)}
OCR_VER=${OCR_TAG#v}
ref=$(gh api "repos/alibaba/open-code-review/git/ref/tags/$OCR_TAG" --jq '.object | "\(.type) \(.sha)"')
OCR_SHA=${ref#* }
[ "${ref%% *}" != tag ] || OCR_SHA=$(gh api "repos/alibaba/open-code-review/git/tags/$OCR_SHA" --jq .object.sha)
echo "latest: opencode $OC_VER ($OC_INT)"
echo "        open-code-review $OCR_VER ($OCR_SHA)"

drift=0
repos=()
while read -r r; do
  [ -z "${PINS_REPOS:-}" ] || [[ " $PINS_REPOS " == *" $r "* ]] || continue
  gh api "repos/$OWNER/$r/contents/.github/workflows/ci-autofix.yml" --jq .name >/dev/null 2>&1 && repos+=("$r")
done < <(gh repo list "$OWNER" --limit 100 --json name,isArchived --jq '.[] | select(.isArchived | not) | .name')

changed=""
for r in "${repos[@]}"; do
  for f in "${FILES[@]}"; do
    body=$(gh api "repos/$OWNER/$r/contents/.github/workflows/$f.yml" --jq .content 2>/dev/null | base64 -d 2>/dev/null) || continue
    [ -n "$body" ] || continue
    cur_oc=$(sed -n 's/^  OPENCODE_VERSION: *\(.*\)$/\1/p' <<<"$body")
    cur_int=$(sed -n 's/^  OPENCODE_INTEGRITY: *\(.*\)$/\1/p' <<<"$body")
    cur_ocr=$(sed -n 's/^  OCR_VERSION: *\(.*\)$/\1/p' <<<"$body")
    cur_sha=$(sed -n 's|.*alibaba/open-code-review@\([0-9a-f]*\) # v.*|\1|p' <<<"$body")
    bad=""
    [ -z "$cur_oc" ] || { [ "$cur_oc" = "$OC_VER" ] && [ "$cur_int" = "$OC_INT" ]; } || bad="$bad opencode $cur_oc"
    [ -z "$cur_ocr" ] || { [ "$cur_ocr" = "$OCR_VER" ] && [ "$cur_sha" = "$OCR_SHA" ]; } || bad="$bad ocr $cur_ocr"
    if [ -n "$bad" ]; then drift=1; changed="$changed$r $f"$'\n'; echo "DRIFT $r/$f:$bad"; else echo "ok    $r/$f"; fi
  done
done

[ "$drift" = 1 ] || { echo "no drift"; exit 0; }
[ "$mode" = --update ] || { echo "drift found: run with --update after reading the changelog of the new version"; exit 1; }

# shellcheck disable=SC2013  # the words are repository and file names, no spaces
for r in $(awk '{print $1}' <<<"$changed" | sort -u); do
  branch="ci/factory-pins-$OC_VER-$OCR_VER"
  main=$(gh api "repos/$OWNER/$r/git/ref/heads/main" --jq .object.sha)
  gh api -X POST "repos/$OWNER/$r/git/refs" -f ref="refs/heads/$branch" -f sha="$main" --silent
  # shellcheck disable=SC2013
  for f in $(awk -v r="$r" '$1 == r {print $2}' <<<"$changed"); do
    path=".github/workflows/$f.yml"
    info=$(gh api "repos/$OWNER/$r/contents/$path?ref=$branch")
    new=$(jq -r .content <<<"$info" | base64 -d \
      | sed -e "s|^  OPENCODE_VERSION: .*|  OPENCODE_VERSION: $OC_VER|" \
            -e "s|^  OPENCODE_INTEGRITY: .*|  OPENCODE_INTEGRITY: $OC_INT|" \
            -e "s|^  OCR_VERSION: .*|  OCR_VERSION: $OCR_VER|" \
            -e "s|alibaba/open-code-review@[0-9a-f]* # v.*|alibaba/open-code-review@$OCR_SHA # v$OCR_VER|")
    gh api -X PUT "repos/$OWNER/$r/contents/$path" -f branch="$branch" -f sha="$(jq -r .sha <<<"$info")" \
      -f message="ci(ci): bump the factory pins in $f.yml (opencode $OC_VER, OCR $OCR_VER)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" \
      -f content="$(base64 <<<"$new")" --silent
  done
  pr=$(gh pr create -R "$OWNER/$r" --base main --head "$branch" --title "ci(ci): bump the factory pins (opencode $OC_VER, OCR $OCR_VER)" \
    --body "Pins of the factory moved by scripts/factory-pins.sh (TASK-282.09): opencode $OC_VER with the registry integrity, open-code-review $OCR_VER with the SHA of its tag. Dependabot does not see these values. Read the changelogs first; the workflows are only exercised after merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)")
  gh pr merge "$pr" -R "$OWNER/$r" --auto --squash
  echo "opened $pr"
done
