# agent-shell-watch: the runners view (TASK-284.2–284.4, 2026-10-05)

Source of the decision: backlog doc-311 (Fable's verdict: extend this mod, no new
`agent-foreign-watch`) and the owner's answers on TASK-284: extend the mod, the point is to see
the agents spawned outside Claude (Pi, Devin, Codex), no restart from the pane, history stays in
agent-viewer, Devin tokens show `—`.

## Problem

`/shell-watch` groups every Bash call by the agent that made it (TASK-274). The owner wants a
second reading of the same data: only the **external runners** (`call.runner` is `codex`, `pi`,
`devin`, `ocr`), flat, each with its verdict, who started it, whether its subscription still has
room, and what it cost.

## Stage 1 — `/shell-watch runners` (TASK-284.2)

- State: `view: "agents" | "runners"` (PluginState key `view`, default `"agents"`; an atom per module
  like `folds`, no module variables). `$.store.set("view", …)` keeps it for the next session.
- Entry: `/shell-watch runners` sets `view` and opens/refocuses the pane; `/shell-watch agents`
  (alias `groups`) sets it back; bare `/shell-watch` keeps the current view. Key `r` in the pane
  toggles (`[ r runners ]` / `[ r agents ]`), next to `f`, `c`, `q`.
- Model, `hooks/model/runners.ts`, pure:
  `runnersOf(calls, agents, now) → Runner[]` where `Runner = { call, by }` and `by` is the
  launching group's label (`groupLabelOf`, so `main` or `type: description ↳ parent`).
  `urgencyOrder`: the existing `RANK` order of a call's status (hung, failed, quiet, running,
  stopped, done…), then the newest first; ties keep `paneOrder`. Not a second ranking: export and
  reuse `RANK`/`paneOrder`.
- Pane: no group headers, no fold; one line per runner using the existing row (`rowOf`), plus the
  launcher: `by main` / `by general-purpose: review spec`, dim, after the label. The verdict
  (`outcomeOf`) is already the row's outcome. Expanding (digit / toggle) and `s stop` work as in
  the agents view. The first line is a summary `runners · N · k live · f failed`. An empty list
  says `No runners yet.`
- Height: `rowsWantedOf` has a runners twin (rows = chrome + 1 summary + Σ `rowsOf`); the open call
  in `slash-command.ts`, `setFolds` (not needed: no folds) and the view toggle ask for the rows
  again, keeping the keyboard focus.
- Status line: unchanged in stage 1.
- Done when: unit tests for `runnersOf` (filter, `by`, order, nested agent) and the pane in both
  terminal and desktop kits; **live scenario** as TASK-274 (tmux, real Claude Code): a main loop
  with a hung background wait plus a `general-purpose` subagent that starts a fake `devin`
  (RATE_LIMIT) → `/shell-watch runners` shows the fake devin with `by general-purpose…` and its
  verdict `RATE_LIMIT …`, `r` flips between views; `demo/demo.tape` and `demo/demo.gif`
  re-recorded; README documents the view; `npm run check` green; PR merged.

## Stage 2 — subscription limits (TASK-284.3)

- Source 1, `~/.local/state/executor-limits/{devin,pi,codex}`: a file holds the reset epoch
  (seconds, plain integer, one line). Future epoch → `limit until HH:MM` (local time), past or no
  file → `ok`. A damaged file reads as `ok`.
- Source 2, Codex's own accounting: the newest `~/.codex/sessions/*/*/*/rollout-*.jsonl`, `tail -c
65536`, last `token_count` event: `payload.rate_limits.primary.{used_percent, window_minutes,
resets_at}` (and `secondary` when not null). Shown as `codex 100% · resets Sun 14:08`. The
  file takes precedence for "is it blocked now" only when its epoch is in the future; the rollout
  adds the percent. Both are shown, not merged.
- `hooks/model/limits.ts`: pure parsers `limitFileOf(text, now)` and `codexLimitOf(tail, now)`; the
  reading is in the poller module and **only while the pane is open in the runners view** (reads
  by tail, never the whole file; one `find`-free `ls -t` of the newest rollout, throttled to the
  poller's 2 s tick, rollout lookup at most every 30 s).
- Display: a `limits:` line under the runners summary, `limits: devin ok · pi ok · codex 100%
resets Sun 14:08`; the status line adds `⏳ codex limit` only while a limit is active.
- State key `limits: Record<Executor, LimitView>`; absent until first read.
- Done when: parser tests with fixtures cut from real files (a real rollout `token_count` line and
  a real executor-limits file), future/past epoch cases; reading verified live with a real file in
  `~/.local/state/executor-limits` set by the test only inside a temp `HOME` override, never the
  owner's real file; README; PR merged.

## Stage 3 — tokens and cost (TASK-284.4)

- Pi: session JSONL in `~/.pi/agent/sessions/--<cwd with / as ->--/*.jsonl`; every assistant
  `message.usage` has `input, output, cacheRead, cacheWrite, reasoning, totalTokens` and
  `cost.total` (dollars). Sum over the file. Matching a call to its file: the session header
  line `{"type":"session","timestamp","cwd"}` — take files with a header timestamp ≥ the call's
  `startedAt − 2 s`, then prefer the one whose first user message starts with the call's prompt
  (`promptWordsOf`), else the nearest start. Only for live and recently ended pi calls; read with
  `tail -c 262144` plus the header line (`head -n 1`). ponytail: a long session larger than the
  tail window under-counts; the cell then shows `≥`.
- Codex: the same rollout files as stage 2: `total_token_usage.total_tokens` of the last
  `token_count` in the file whose `session_meta` timestamp matches the call's start. Needs the
  runner to stop using `--ephemeral` (`~/.claude/agents/codex-runner.md`, via chezmoi: owner's
  decision on TASK-284). Without a rollout the cell is `—`.
- Devin: no local data, always `—`.
- Display: the runner row's detail line (when expanded) and a compact cell on the line: `tok 23k ·
$0.002`; `—` when unknown. Cost only for Pi (Codex rollout has none).
- Done when: a real `pi -p` run shows tokens and cost equal to the sum computed by `jq` from its
  JSONL; Devin shows `—`; a real non-ephemeral `codex exec` shows its total; README; PR merged.

## Not doing

Restart, `ask` through `session.send`, history between sessions (agent-viewer), a per-executor
queue, new hooks. The sources are read only when the runners view is open.

## Risks

The verdict line is a contract with the watchdog (TASK-271); Pi/Codex file formats are the
tools' private formats (fixtures are real excerpts, parsers return `undefined` on any surprise,
never throw); poll I/O (tails only, throttled, only with the view open); hot reload (all state in
atoms, nothing at module level).
