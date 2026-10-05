#!/usr/bin/env bash
# Picks the findings of an `ocr scan --format json` file that night-fix may verify.
#   usage: PROTECTED=... [MAX_FINDINGS=3] [SEEN=<file of fingerprints>] [SCAN_TOKEN_BUDGET=<n>]
#          night-select.sh <scan.json> <out.json> [<fps.json>]
# Keeps critical|high findings of category bug|security, skips protected paths and
# package-lock.json, dedupes by fingerprint = first 12 hex of
# sha256(path "\n" category "\n" existing_code with whitespace collapsed; the content
# when there is no code), skips fingerprints listed in SEEN, takes critical first.
# The fingerprint ignores line numbers and the model's wording, so the same finding in
# the next scan keeps its id; two findings on identical code of one file share it.
# fps.json = {complete, scan_tokens, fps}: the fingerprints of ALL candidates (before
# the MAX_FINDINGS cut) and whether the scan was complete (success and under 90% of
# SCAN_TOKEN_BUDGET: OCR stops at the budget and publishes what it found), which is what
# lets night-act close the issue of a finding that is gone. out.json is an array of
# {id, path, start_line, end_line, severity, category, content, existing_code, suggestion_code};
# text fields are length-capped. Finding text is only ever written to files.
set -euo pipefail

scan=${1:?scan json}
out=${2:?output json}
fps_out=${3:-/dev/null}
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
    | select((.path | startswith("tests/")) | not)
    | {path, start_line: (.start_line | floor), end_line: (.end_line | floor), severity, category,
       content: (.content | clip), existing_code: (.existing_code | clip), suggestion_code: (.suggestion_code | clip)} ]
  | sort_by(if .severity == "critical" then 0 else 1 end)
  | .[]' "$scan" > "${out}.candidates"

printf '[]' > "$out"
taken="${out}.taken"
allfps="${out}.allfps"
: > "$taken"
: > "$allfps"
n=0
while IFS= read -r f; do
  fp=$(jq -j '(.existing_code | gsub("\\s+"; " ") | sub("^ "; "") | sub(" $"; "")) as $code
    | .path, "\n", .category, "\n", (if $code == "" then .content else $code end)' <<<"$f" | sha256sum | cut -c1-12)
  echo "$fp" >> "$allfps"
  [ "$n" -lt "$max" ] || continue
  path=$(jq -r .path <<<"$f")
  skip=false
  while IFS= read -r glob; do
    [ -z "$glob" ] && continue
    # shellcheck disable=SC2254
    case "$path" in $glob) skip=true; break;; esac
  done <<<"$PROTECTED"
  [ "$skip" = false ] || continue
  ! grep -qx "$fp" "$taken" || continue
  ! grep -qx "$fp" "$seen" || continue
  echo "$fp" >> "$taken"
  n=$((n + 1))
  jq --arg id "$fp" --argjson f "$f" '. + [{id: $id} + $f]' "$out" > "${out}.next"
  mv "${out}.next" "$out"
done < "${out}.candidates"
jq -n --slurpfile scan "$scan" --argjson budget "${SCAN_TOKEN_BUDGET:-0}" --rawfile all "$allfps" '
  ($scan[0].summary.total_tokens // 0) as $t
  | {complete: ($scan[0].status == "success" and $budget > 0 and $t < $budget * 0.9),
     scan_tokens: $t, fps: ($all | split("\n") | map(select(. != "")) | unique)}' > "$fps_out"
rm -f "${out}.candidates" "$taken" "$allfps"
jq -r '.[].id' "$out"
