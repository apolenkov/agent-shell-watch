# agent-shell-watch: group calls by agent (TASK-274, 2026-10-05)

## Problem

The `/shell-watch` pane is a flat list of commands. When subagents and the
runners they start (Codex, Pi, Devin) work alongside the main loop, the owner
cannot tell whose call is whose, or which session is alive. The live case:
his own hung background wait loops (`⚠ hung 9h`) and a subagent's
`✗ RATE_LIMIT devin · …` were mixed in one list.

## Arena (Devin, Pi, Codex, Fable) — agreements

All four proposals converge on:

- **Group key** `call.agentId ?? "main"`; the data is already in every
  `ShellCall`. Grouping is a pure model function, no new hooks.
- **A runner is a row inside its agent's group**, not a group of its own (it
  is already labelled `devin · …`).
- **Rollup status** of a group from the existing urgency rank, so the most
  important group sorts first, and calls keep their order inside a group.
- **Agent metadata** (`type`, `description`, `status`, `parentId`) from
  `$.agent.list()`, kept in state and refreshed by the 2 s poller.
- **Collapsible groups**, finished ones collapsed by default; headers count in
  the height budget (`rowsWantedOf`, `visibleOf`).
- **Status line** says whose the leading call is (Devin, Fable; Pi kept it
  unchanged, Codex rewrote it).
- Out of v1: per-group stop/clear, filters, persisting folds, deep trees.

## Disagreements and choices

| Question                             | Options                                                               | Choice                                                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nesting of a subagent's subagent     | tree (Devin, Codex) / own group marked `↳ parent` (Fable) / flat (Pi) | Own group, label ends `↳ <parent label>`: no tree layout, still says whose.                                                                                                              |
| Fold all                             | `x` (Devin), `e`/`o` (Pi), `a` (Codex), `f` (Fable)                   | One toggle `f` (free since the filter went): folds all if any group is open, else opens all.                                                                                             |
| Rollup "hung" for a group            | worst call (Devin, Pi, Fable) / never claim hung for a group (Codex)  | Worst live call: a group is only as hung as its own call says; the call's rule (silence ≥ `hangMin`) is unchanged and the header names the call's state.                                 |
| Failed call in a still-running agent | failed (Devin, Pi, Fable) / "alive · 1 error" (Codex)                 | Failed while the failure is recent (the status line's 2 min window), so a `RATE_LIMIT` is seen; afterwards the agent's own status decides.                                               |
| Agents without Bash calls            | show (Devin, Codex, Fable as `idle`) / not (Pi)                       | Not shown in v1: Claude Code lists agents itself; this mod is about shells.                                                                                                              |
| Header content                       | 2 lines (Codex) / 1 line                                              | One line: `[n ▾] glyph label · N calls · k live` (`· k live` left out at 0); a folded header adds the leading call's last line (the leading call: the first in the group's `paneOrder`). |

## Model (`hooks/model/groups.ts`)

```ts
// types/index.d.ts
interface ShellAgentInfo { type: string; description: string; status: string; parentId?: string }
type GroupStatus = ShellStatus | "idle";
interface Group { key: string; label: string; calls: ShellCall[];
  status: GroupStatus; live: number }
groupsOf(calls, agents, now) → Group[]   // ordered, most urgent first
```

- `label`: `main`; else `type: description` from the agent metadata, else
  `agent <id>`; a nested agent appends ` ↳ <parent label>`.
- Rollup, first match: a live call → the worst live status (hung > quiet >
  running); a failed call ended within 2 min → failed; agent status
  `failed`/`killed` → failed; agent `running` → `idle` (dim gray `◌`,
  "idle"); otherwise the most urgent settled status of its calls by `RANK`
  with `failed` left out (stopped, then done/nomatch, then denied), `done`
  when none is left. **main counts as an agent whose status is `running`**:
  the main loop is always there, so its old failures read `idle`, not
  `failed` for ever. An id unknown to `$.agent.list()` has no agent status.
- Order: rollup rank (hung, failed, quiet, running, idle, stopped, done,
  nomatch, denied), then the newest call first; inside a group, the existing
  `paneOrder`.
- State: `agentInfo: Record<id, ShellAgentInfo>` replaces the label-only
  `agents` map (the three `agentsAtom` declarations and `PluginState.agents`
  go; no migration code: the next `session.start` backfill fills the new
  key). Written by `tool.call` (first sight), the backfill (all listed
  agents, not only running ones) and the poller (statuses, every 2 s while
  any call has an `agentId`). The list's entry wins over the kept one (it
  carries the fresh status); a failing `$.agent.list()` returns `undefined`
  and keeps the last snapshot.
- `GLYPH`, `COLOR` and `DIM` gain `idle`: `◌`, gray, dim.

## Pane

```
[ c clear ] [ f fold ] [ q close ]
[ 1 ▾ ] ✗ general-purpose: review spec · 2 calls · 1 live
[ 2 ▸ ] ◐ 0:51 output 1s ago  devin · review spec  [ s stop ]
        bg · devin -p 'review the spec' 2>&1 | tee /t/d.log
        › Waiting for session…
[ 3 ▸ ] ✗ 0:03 RATE_LIMIT 1790000000  devin · retry
        devin -p 'retry'
[ 4 ▸ ] ⚠ main · 5 calls · 1 live · › step 12
+2 older
1–9 open · f fold · c clear · q close · Esc → prompt
```

- One running index `1–9` over visible headers and rows, top to bottom; a
  header's button folds or opens its group, a row's opens its details.
- Fold state: `folds: Record<key, boolean>` (the person's choices) over the
  default (folded unless the rollup is live, failed or idle). `f` toggles all.
- A row's second line drops the owner (the header says it): `bg · <command>`
  or `<command>`.
- Height: every header is drawn (a folded group costs one line); the rows of
  open groups, as one list in group order, go through the existing
  `visibleOf` with `rows − chrome − headers` lines, and each header draws the
  shown rows of its group. A selected row in a folded group is not drawn and
  costs nothing. `rowsWantedOf(groups, folds)` adds one line per group.

## Status line

The leading segment names its owner: `⚠ hung 9h main · Wait …`,
`✗ general-purpose · devin · retry RATE_LIMIT 1790000000`; the owner is
`main` or the agent's type, cut to 16 cells. `statusLineOf(calls, now,
agents)` gains the agent table; `tick` reads `agentInfo`.

## Tests

- `tests/model/groups.test.ts`: key, label (fallback, nested), each rollup
  branch incl. the 2 min edge (failed → idle) and main's old failure, an
  unknown `agentId` (label `agent <id>`, status from its calls), order.
- Pane on terminal and desktop: main plus a subagent, headers, default folds,
  folding by header and `f`, digits across headers and rows, the second line
  without the owner.
- Layout: headers in the budget, `rowsWantedOf` counts them.
- Status line: the owner's case (main hung, subagent RATE_LIMIT).
- Engine: the poller updates an agent's status from `$.agent.list()` and
  keeps the snapshot when the list fails.
- Pane: digits renumber after a fold; `f` after a new group appears (its
  default applies); a selected row in a folded group costs no line; the
  focused hint names `f fold`; the old `main · ls` / `bg · main · …` second
  lines become `ls` / `bg · …`.

## Live check

tmux: a subagent runs a fake rate-limited `devin` (prints `RATE_LIMIT
<epoch>`, exits 1) and the main loop a hung background `sleep`; `/shell-watch`
shows two groups with the right rollups, `f` and a header's digit fold and
open. The fake `devin` only prints; if a real runner guard on the machine
records the limit under `~/.local/state/executor-limits`, that file is
removed afterwards.

## Review

Fable (2026-10-05): APPROVE WITH CHANGES — applied: main counts as a
running agent and the settled fallback leaves `failed` out; headers are never
dropped (one `visibleOf` pass over open groups' rows); attributions fixed; the
agent list wins in merges and a failed list keeps the snapshot; `agentInfo`
replaces `agents` without migration code; `statusLineOf` takes the agents;
`idle` gets a glyph and color; the missing tests are listed.
