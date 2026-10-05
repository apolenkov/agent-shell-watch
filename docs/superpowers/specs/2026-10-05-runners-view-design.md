# agent-shell-watch: the runners view (TASK-284.2–284.4, 2026-10-05)

Source: backlog doc-311 (Fable's verdict: extend this mod, no new `agent-foreign-watch`) and the
owner's answers on TASK-284: extend the mod, the point is to see the agents spawned outside Claude
(Pi, Devin, Codex), no restart from the pane, history stays in agent-viewer, Devin tokens show `—`.
Fable's review of this spec: APPROVE WITH CHANGES, all changes are folded in below.

## Problem

`/shell-watch` groups every Bash call by its agent (TASK-274). The owner wants a second reading
of the same data: only the **external runners** (`call.runner` set), flat, each with its verdict,
who started it, whether its subscription has room, and what it cost.

## Stage 1 — `/shell-watch runners` (TASK-284.2)

- State: `view: "agents" | "runners"`, PluginState key `view`, default `"agents"`, an atom per
  module like `folds`, nothing at module level. It is kept with `$.store.set("view", …)` and
  `restore` in `register.tsx` reads `$.store.get("view")` back into the atom.
- Entry: `/shell-watch runners` sets the view and opens or refocuses the pane;
  `/shell-watch agents` (alias `groups`) sets it back; bare `/shell-watch` keeps the view. Key `r`
  toggles.
- Model, `hooks/model/runners.ts`, pure: `runnersOf(calls, agents) → Runner[]`,
  `Runner = { call, by }`: `urgencyOrder(calls.filter(c => c.runner !== undefined))` (already in
  `calls.ts`; do not add a second ranking, `groups.ts`'s `RANK` is the groups' and stays
  private), `by = groupLabelOf(call.agentId ?? "main", agents)`.
- Pane: no group headers and no fold. Toolbar `[ r agents ] [ c clear ] [ q close ]` (no
  `f fold`); a text line (not a Button) `runners · N · k live · f failed`; then one `rowOf` per
  runner, digits and `s stop` as in the agents view. `by` goes on the second line through
  `sourceOf` (`row.tsx`): `by main · bg · <cmd>`. Own hint line for the view. Empty: `No runners
yet.` Fit with `visibleOf(runners, selected, budget - 1)` directly, no layout twin.
- Height: one `rowsWantedNow($)` replaces the three copies (`slash-command.ts`, `pane.tsx`
  `setFolds`, `register.tsx`); it reads `view`, calls, agents, folds. A runners twin of
  `rowsWantedOf` lives in `pane-items.ts` (it owns `CHROME/ROWS_MIN/ROWS_MAX`). One `reopen($)`
  (after `setFolds`' `$.ui.open`, `focus: true`) runs on `r` and on the command.
- Status line: unchanged in stage 1.
- Tests: `runnersOf` (filter, `by`, order, nested agent); the pane in terminal and desktop kits;
  `r` re-opens with the new `rows` (like `tests/view/layout.test.ts`); `view` restored from the
  store after a restart; `No runners yet.`.
- Live scenario as TASK-274 (tmux, real Claude Code): main with a hung background wait and a
  `general-purpose` subagent that starts a fake `devin` (RATE_LIMIT) → `/shell-watch runners`
  shows the fake devin, `by general-purpose: …`, its verdict; `r` flips the views. Re-record
  `demo/demo.tape` and `demo/demo.gif`; README documents the view; `npm run check`; PR merged.

## Stage 2 — subscription limits (TASK-284.3)

One verdict per executor, not two sources side by side. Executor `blocked` when (a) its
`~/.local/state/executor-limits/<name>` epoch (seconds, one integer) is in the future, or (b) for
Codex, the last rollout `token_count` has `rate_limits.primary.used_percent >= 100` and
`resets_at > now`. Real data that forces (b): the codex file holds a past epoch while the newest
rollout says `100%`, `resets_at` days ahead. Shown as `codex limit until Sun 14:08` (HH:MM today,
weekday + HH:MM later); not blocked → `ok`, with `NN%` for Codex when the rollout is known. A
damaged or missing file reads as `ok`.

- `hooks/model/limits.ts`, pure: `limitFileOf(text, now)`, `codexLimitOf(tailText, now)`. The
  tail is `tail -c 65536` run with `$.process.run` (`$.fs.read` refuses files over 4 MiB, rollouts
  are 2–10 MB); the first line of a tail is cut mid-JSON, so parse line by line and skip what does
  not parse, never throw. `token_count` is `{type:"event_msg", payload:{type:"token_count",
info:{total_token_usage:{total_tokens,…}}, rate_limits:{primary:{used_percent,window_minutes,
resets_at}, secondary}}}`.
- Reading: only while the pane is open in the runners view or a runner is live; `HOME` from
  `$.env.get("HOME")`; the rollout is found with `$.fs.list` of today's and yesterday's
  `~/.codex/sessions/YYYY/MM/DD` (entries carry `mtimeMs`), newest wins; limits are re-read at
  most every 30 s (`readAt` in the `limits` atom, not a module variable).
- State: `limits: Record<"devin"|"pi"|"codex", {blockedUntil?: number, percent?: number}>` plus
  `readAt`.
- Display: a `limits: devin ok · pi ok · codex 100% until Sun 14:08` line under the summary; the
  status line (`statusLineOf` in `format.ts`) adds `⏳ codex limit` only while an executor is
  blocked, same rule.
- Tests: parsers on fixtures cut from real files (one real `token_count` line, a real limits
  file): future, past, 100% + future reset, 100% + past reset, truncated first line, garbage;
  the status line with an active limit; the 30 s throttle. Live: read-only on the real files.

## Stage 3 — tokens and cost (TASK-284.4)

- Pi: `~/.pi/agent/sessions/--<cwd with / as ->--/<UTC start>_<id>.jsonl`, the start with
  milliseconds is in the **file name** (`2026-10-05T14-32-09-661Z_…`). Each assistant
  `message.usage` has `input, output, cacheRead, cacheWrite, reasoning, totalTokens` and
  `cost.total` (dollars). The call's cwd is unknown (`ShellCall` has none), so: `$.fs.list` the
  sessions dir, keep the directories with `mtimeMs >= startedAt - 2 s`, then files whose name
  start is within `[startedAt - 2 s, endedAt ?? now]`. Exactly one candidate → sum the usage over
  `tail -c 262144`; more than one → `—`. The cell is `≥` when the file is larger than the window.
  ponytail: parallel pi runners started in the same second cannot be told apart; the cell is `—`.
- Codex: the rollout whose `session_meta` / file-name time (local time in the name, `Z` in
  `session_meta`) is nearest to the call's start within the same ±2 s rule; `total_tokens` of its
  last `token_count` (cached input is included in it; README says so). Runners that did not use
  `--ephemeral` write one (`codex exec review` always does); `codex-runner.md` drops `--ephemeral`
  via chezmoi (owner's decision on TASK-284), so other runs do too. No rollout → `—`.
- Devin: always `—`.
- Display: compact cell on the runner line, `tok 23k · $0.002`; `—` when unknown; cost for Pi only.
  Read at the same 30 s throttle, only for runners shown, only with the view open.
- Tests: parser on a real Pi excerpt and a real Codex excerpt; two candidates → `—`; windowed `≥`;
  Devin `—`. Live: a real `pi -p` run shows tokens and cost equal to the `jq` sum of its JSONL; a
  real non-ephemeral `codex exec` shows its total; Devin shows `—`.

## Not doing

Restart, `ask` through `session.send`, history between sessions (agent-viewer), a queue, new hooks.

## Risks

The verdict line is a contract with the watchdog (TASK-271); the Pi and Codex file formats are the
tools' private ones (fixtures are real excerpts, parsers return `undefined` on any surprise); poll
I/O (tails only, throttled, only with the runners view open); hot reload (all state in atoms).
