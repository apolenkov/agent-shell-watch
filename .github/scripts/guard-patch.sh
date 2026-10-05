#!/usr/bin/env bash
# Applies an agent's patch to the index of the current checkout and checks it.
#   usage: PROTECTED=... [NIGHT_ID=<12 hex>] guard-patch.sh <patch>
#   exit 0  the patch is applied to the index and passed every check
#   exit 3  rejected: one-line reason on stdout, the tree is reset
# The checks are the ones of the `push` job in ci-autofix.yml (copied, not shared:
# that workflow stays as it is). night-fix adds NIGHT_ID: the patch must then ADD
# files under tests/night-fix/<id>/ and may not touch any other path under tests/.
# Run it from a copy outside the tree: `git apply` can rewrite .github/scripts.
set -euo pipefail

patch=${1:?patch file}
id=${NIGHT_ID:-}
reject() {
  git reset -q --hard HEAD
  git clean -fdq
  echo "$1"
  exit 3
}

# Scripts and the set of dependency names stay as they are; versions may move.
guard='{scripts, names: [(.dependencies // {}), (.devDependencies // {}), (.overrides // {}) | keys]}'
pkg_before=$(jq -cS "$guard" package.json)
[ -s "$patch" ] || reject "the agent proposed no change"
git apply --index "$patch" 2> /dev/null || reject "the patch does not apply"

# Protected paths, deletions, tests. A violation throws the whole patch away.
bad=$(git diff --cached --name-status --no-renames -z | while IFS= read -r -d '' status && IFS= read -r -d '' path; do
  [ "$status" != D ] || { echo "deletes $path"; break; }
  while IFS= read -r glob; do
    [ -z "$glob" ] && continue
    # shellcheck disable=SC2254
    case "$path" in $glob) echo "touches protected $path"; break 2;; esac
  done <<<"$PROTECTED"
  if [ -n "$id" ]; then
    case "$path" in
      "tests/night-fix/$id/"*) [ "$status" = A ] || { echo "modifies $path"; break; };;
      tests/*) echo "touches the existing test $path"; break;;
    esac
  fi
done)
[ -z "$bad" ] || reject "the patch $bad (.github, hooks, check config, secrets, existing tests, deletions are off limits)"
if [ -n "$id" ]; then
  git diff --cached --name-only --no-renames | grep -q "^tests/night-fix/$id/" || reject "the patch has no reproduction test under tests/night-fix/$id/"
fi
[ "$(jq -cS "$guard" package.json)" = "$pkg_before" ] || reject "the patch changes scripts or dependency names in package.json"
# Captured, not piped into `grep -q`: its early exit would SIGPIPE the producer.
foreign=$(jq -r '.packages[].resolved // empty' package-lock.json | grep -v '^https://registry.npmjs.org/' || true)
[ -z "$foreign" ] || reject "the patch points package-lock.json outside the npm registry"
links=$(git diff --cached --raw --no-renames | grep -E '^:[0-7]* (120000|160000)' || true)
[ -z "$links" ] || reject "the patch adds a symlink or a submodule"
bin=$(git diff --cached --numstat | grep '^-' || true)
[ -z "$bin" ] || reject "the patch adds a binary file"
read -r files lines < <(git diff --cached --numstat | awk '{n++; l+=$1+$2} END {print n+0, l+0}')
{ [ "$files" -le 25 ] && [ "$lines" -le 600 ]; } || reject "the patch is too large ($files files, $lines lines)"
