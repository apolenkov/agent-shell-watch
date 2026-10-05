#!/usr/bin/env bash
# Picks the findings of an `ocr scan --format json` file that night-fix may verify.
#   usage: PROTECTED=... [MAX_FINDINGS=3] [SEEN=<file of fingerprints>] night-select.sh <scan.json> <out.json>
# Keeps critical|high findings of category bug|security, skips protected paths and
# package-lock.json, dedupes by fingerprint = first 12 hex of
# sha256(path "\n" start ".." end "\n" content), skips fingerprints listed in SEEN,
# takes critical first. out.json is an array of
# {id, path, start_line, end_line, severity, category, content, existing_code, suggestion_code};
# text fields are length-capped. Finding text is only ever written to files.
set -euo pipefail

scan=${1:?scan json}
out=${2:?output json}
max=${MAX_FINDINGS:-3}
seen=${SEEN:-/dev/null}
cap=2000

# A usable path is a plain relative one: no "..", no leading "/", no odd characters.
jq -c --argjson cap "$cap" '
  def clip: (. // "") | tostring | .[0:$cap];
  [ (.comments // [])[]
    | select((.severity == "critical" or .severity == "high") and (.category == "bug" or .category == "security"))
    | select((.path | type) == "string" and (.path | test("^[A-Za-z0-9._/@+-]+$")) and (.path | startswith("/") | not) and (.path | test("(^|/)\\.\\.(/|$)") | not))
    | select((.start_line | type) == "number" and (.end_line | type) == "number" and .start_line >= 1 and .end_line >= .start_line)
    | select((.path | endswith("package-lock.json")) | not)
    | {path, start_line: (.start_line | floor), end_line: (.end_line | floor), severity, category,
       content: (.content | clip), existing_code: (.existing_code | clip), suggestion_code: (.suggestion_code | clip)} ]
  | sort_by(if .severity == "critical" then 0 else 1 end)
  | .[]' "$scan" > "${out}.candidates"

printf '[]' > "$out"
taken="${out}.taken"
: > "$taken"
n=0
while IFS= read -r f; do
  [ "$n" -lt "$max" ] || break
  path=$(jq -r .path <<<"$f")
  skip=false
  while IFS= read -r glob; do
    [ -z "$glob" ] && continue
    # shellcheck disable=SC2254
    case "$path" in $glob) skip=true; break;; esac
  done <<<"$PROTECTED"
  [ "$skip" = false ] || continue
  fp=$(jq -j '.path, "\n", .start_line, "..", .end_line, "\n", .content' <<<"$f" | sha256sum | cut -c1-12)
  ! grep -qx "$fp" "$taken" || continue
  ! grep -qx "$fp" "$seen" || continue
  echo "$fp" >> "$taken"
  n=$((n + 1))
  jq --arg id "$fp" --argjson f "$f" '. + [{id: $id} + $f]' "$out" > "${out}.next"
  mv "${out}.next" "$out"
done < "${out}.candidates"
rm -f "${out}.candidates" "$taken"
jq -r '.[].id' "$out"
