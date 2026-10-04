# shell-flow

[![ci](https://github.com/apolenkov/claude-shell-flow/actions/workflows/ci.yml/badge.svg)](https://github.com/apolenkov/claude-shell-flow/actions/workflows/ci.yml)
[![codeql](https://github.com/apolenkov/claude-shell-flow/actions/workflows/codeql.yml/badge.svg)](https://github.com/apolenkov/claude-shell-flow/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/apolenkov/claude-shell-flow/badge)](https://scorecard.dev/viewer/?uri=github.com/apolenkov/claude-shell-flow)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

See at a glance that the work is moving: time ticking, output fresh, nothing
failed. shell-flow watches this session's Bash calls (main loop and every
subagent), background tasks, and above all the external agent runs delegated
through the shell: Codex, Pi, Devin and OpenCodeReview (`ocr`).

## What it shows

An always-on status line while anything runs, or a call failed in the last
2 minutes. The most urgent call leads (hung, failed, quiet, running; a runner
before a plain shell), the rest are counted as `+N hung`, `+N failed`,
`+N quiet`, `+N bg`, `+N running`. Claude Code labels it with the plugin's
name:

```
shell-flow: ◐ codex · Review diff 2:13 · output 4s ago · › applying patch src/a.ts · +1 bg
shell-flow: ⚠ quiet 6m pi · Fix flaky test 7:40 · +2 running
shell-flow: ◐ Wait 0:45 · no output · 45s
shell-flow: ⚠ hung 12m devin · Port module
shell-flow: ✗ Typecheck exit 2 · +1 bg
shell-flow: ✗ pi · Fix flaky test RATE_LIMIT 1790000000
```

`/shell-flow` opens the pane. Live calls come first (hung, quiet, running),
then failures, finished calls and denied ones, the newest first in each; what
does not fit the pane's height becomes a dim `+N older` line, so the newest
and live rows never need scrolling. Each row is three lines: state before the
label (a narrow pane cuts the label, never the time or outcome), where it ran
and its command, and its last output line (a failure's last error in red, a
denial's reason, dim). Every line is one line, cut to the pane's width.

```
[ c clear ] [ q close ]
[ 1 ▸ ] ◐ 0:51 output 1s ago  Count steps  [ s stop ]
      bg · main · for i in $(seq 40); do echo step $i; sleep 2; done
      › step 26
[ 2 ▸ ] ✗ 0:03 exit 2  Typecheck
      main · tsc -p .
      ✗ src/a.ts(3,1): error TS2322: Type 'string' is not assignable…
[ 3 ▸ ] ● 0:01 exit 0  List files
      main · ls -1 | head -3
      › README.md
+4 older
1–9 open · c clear · q close · Esc → prompt
```

`/shell-flow` gives the pane the keyboard (again, if it already is open:
it refocuses); Esc hands the keys back to the prompt and the pane stays. The
first row's `[ 1 ▸ ]` holds the focus, so Enter expands the most important call.
Each button shows its key: `1`–`9` expand or collapse that row (the full
command, last 40 lines, stderr, output and watch files), `c` clear finished calls, `s` stop the running background
call (when there is one), `q` close. Tab walks the buttons, Enter presses.
The pane remembers across sessions whether you left it open.

Glyphs: `◐` running, `●` done, `✗` failed, `⚠` quiet or hung, `○` stopped,
dim `○ denied` for a call refused before it ran (a permission rule, a hook,
you), which never reaches the status line.
A runner's outcome is its guard verdict (`DONE n`, `RATE_LIMIT epoch`,
`STALLED reason`, `BUSY pid file`), else the exit code. `[ stop ]` on a
running background row stops it with `TaskStop`.

## Install

This repository is its own marketplace:

```
/plugin marketplace add apolenkov/claude-shell-flow
/plugin install shell-flow@claude-shell-flow
```

It is also listed, with its sibling mods, in the
[claude-mods](https://github.com/apolenkov/claude-mods) marketplace (an
existing `shell-flow@claude-mods` install keeps working):

```
/plugin marketplace add apolenkov/claude-mods
/plugin install shell-flow@claude-mods
```

Requirements: Claude Code 2.1.288 or later with function hooks enabled
(`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, early access), and `tail` on `PATH`.

## Options

| Option        | Default | Meaning                                                   |
| ------------- | ------- | --------------------------------------------------------- |
| `columns`     | 52      | Width asked for the docked pane                           |
| `openOnStart` | false   | Open the pane at start until you have opened or closed it |
| `maxCalls`    | 50      | Calls kept, the oldest finished dropped first             |
| `quietMin`    | 5       | Minutes without new output before a running call is quiet |
| `hangMin`     | 10      | Minutes without new output before a running call is hung  |
| `statusLine`  | true    | Show the status line                                      |

`/shell-flow clear` forgets finished calls; `/shell-flow stop` closes the pane.

## How it works

| Event / timer             | What shell-flow does                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `session.start`           | Registers `/shell-flow`, rebuilds calls made before the mod loaded, starts the tick and poll |
| `tool.call` (Bash)        | Records the call (label from the input `description`), awaits it, records exit and output    |
| `session.append`          | A `<task-notification>` row settles its background call (status, exit code)                  |
| tick, every 1 s           | Advances elapsed time and redraws the status line                                            |
| poll, every 2 s           | `fs.stat` of the watch or output file → freshness, quiet, hung; `tail -n 40` for runner rows |
| `ui.render` (Pane)        | Draws the pane; the selected row's tail is read once when it is selected                     |
| `ui.open`                 | Rebuilds missed calls from `$.session.messages()` (main loop and running agents)             |
| `ui.close`, `command.run` | Opens and closes the pane; the choice is kept in `$.store` for the next session              |

A runner is a command whose executable (past `NAME=value` and `cd … &&`,
after a guard's `--`, or inside `bash -c '…'` / `sh -c "…"`) is `codex`,
`pi`, `devin` or `ocr`. Its live output is the guard's `--watch-file`, its
`| tee [-a] /path`, or its absolute stdout redirect (`> /path/run.log`); with
no description its label is the first words of its prompt. The verdict is read
from the Bash output once the run ends. shell-flow sees the command as the
model wrote it, before a `PreToolUse` settings hook wraps it, and recognises
both forms. A `TaskStop` (the model's or the pane's) settles its call as
stopped; an interrupted call is stopped, not failed. Every hook passes its
event on unchanged.

## Privacy

No network, no telemetry. It reads only this session's transcript and the
output and watch files of its own Bash calls, keeps its list in the session's
memory, and stores one value across sessions: whether the pane was left open.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md): `npm ci`, then `npm run check`; try it
live with `claude --plugin-dir .`. Releases are cut by release-please; the
history before 0.2.0 comes from
[claude-mods](https://github.com/apolenkov/claude-mods).
