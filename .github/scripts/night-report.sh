#!/usr/bin/env bash
# Builds the one comment of a night-fix run.
#   usage: RUN_URL=... SCAN_RUN_URL=... night-report.sh <findings.json> <outcomes dir> > comment.md
# outcomes dir holds <id>.json = {id, status, reason, evidence, pr} per finding.
# Finding text is untrusted: every piece goes through a fenced block whose fence is
# longer than any backtick run inside it, with "@" neutralized and the length capped.
set -euo pipefail

findings=${1:?findings.json}
outcomes=${2:?outcomes dir}
shopt -s nullglob
files=("$outcomes"/*.json)
[ "${#files[@]}" -gt 0 ] || { echo "no outcomes" >&2; exit 1; }

jq -rn --arg run "${RUN_URL:-}" --arg scan "${SCAN_RUN_URL:-}" \
  --slurpfile findings "$findings" --slurpfile outs <(jq -c . "${files[@]}") '
  def safe($n): (. // "") | tostring | gsub("@"; "@​") | .[0:$n];
  def fence: (reduce (match("`+"; "g").string | length) as $l (3; if $l >= . then $l + 1 else . end)) as $k | ("`" * $k);
  def block($n): safe($n) as $s | ($s | fence) as $f | "\($f)text\n\($s)\n\($f)";
  ($findings[0] | map({key: .id, value: .}) | from_entries) as $byid
  | def infra: .reason | IN("the verification did not finish", "the agent wrote no valid verdict.json", "the agent ran out of steps", "the patch does not apply");
  $outs | map(. + {f: $byid[.id]}) as $rows
  | ($rows | map(select(infra | not)) | length) as $n
  | ($rows | map(select(infra)) | length) as $i
  | ([$rows[] | select(.status == "confirmed" and (infra | not))] | length) as $c
  | ([$rows[] | select(.status == "refuted" and (infra | not))] | length) as $r
  | ([$rows[] | select(.status == "needs-human" and (infra | not))] | length) as $h
  | def pct($x): if $n == 0 then "0%" else "\(($x * 100 / $n) | round)%" end;
  "<!-- night-fix-ids: \($rows | map(select(infra | not) | .id) | join(",")) -->",
  "### night-fix run",
  "",
  "Scan: \($scan) · fix run: \($run)",
  "",
  "| id | path:lines | severity | status | PR |",
  "| --- | --- | --- | --- | --- |",
  ($rows[] | "| `\(.id)` | `\(.f.path | safe(120)):\(.f.start_line)-\(.f.end_line)` | \(.f.severity) | \(.status) | \(.pr // "-") |"),
  "",
  "Verified \($n) (infrastructure failures, not counted: \($i)): confirmed \($c) (\(pct($c))), refuted \($r) (\(pct($r))), needs-human \($h) (\(pct($h))).",
  "False-finding rate of this run: refuted share of the verified findings, \($r)/\($n) = \(pct($r)). Confirmed share: \($c)/\($n) = \(pct($c)); a confirmed finding has a reproduction test that fails on main, so the confirmed share is a lower bound of the real ones.",
  "Only confirmed findings get a change (a PR); refuted and needs-human ones get this comment only.",
  "",
  ($rows[] |
    "<details><summary><code>\(.id)</code> \(.status): \(.reason | safe(160) | gsub("[\\n\\r`<]"; " "))</summary>",
    "",
    "Finding:", "", (.f.content | block(1200)), "",
    "Evidence:", "", (.evidence | block(1500)), "",
    "</details>", "")
'
