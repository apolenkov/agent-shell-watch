# shell-flow

See at a glance that the work is moving: time ticking, output fresh, nothing
failed. shell-flow watches this session's Bash calls (main loop and every
subagent), background tasks, and above all the external agent runs delegated
through the shell: Codex, Pi, Devin and OpenCodeReview (`ocr`).

## What it shows

An always-on status line while anything runs, or a call failed in the last
2 minutes. The most urgent call leads (hung, failed, quiet, running; a runner
before a plain shell), the rest are counted:

```
shell: ◐ codex · Review diff 2:13 · output 4s ago · › applying patch src/a.ts · +1 bg
shell: ⚠ quiet 6m pi · Fix flaky test 7:40 · +2 running
shell: ⚠ hung 12m devin · Port module
shell: ✗ Typecheck exit 2 · +1 bg
shell: ✗ pi · Fix flaky test RATE_LIMIT 1790000000
```

`/shell-flow` opens the pane: one row per call, newest first.

```
[ background only ]  [ clear ]  [ close ]
◐ 2:13  codex · Review diff  output 4s ago          [ stop ]
    bg · codex-runner: Review diff · node watchdog.ts --watch-file … -- codex exec …
    › applying patch src/a.ts
● 0:07  Run unit tests  exit 0
    main · npm test
✗ 0:03  Typecheck  exit 2
    main · tsc -p .
      $ tsc -p .                              ← a selected row expands:
      stderr: Exit code 2                       full command, last 40 lines,
      stderr: src/a.ts(3,1): error TS2322       stderr, output and watch files
```

Glyphs: `◐` running, `●` done, `✗` failed, `⚠` quiet or hung, `○` stopped.
A runner's outcome is its guard verdict (`DONE n`, `RATE_LIMIT epoch`,
`STALLED reason`, `BUSY pid file`), else the exit code. `[ stop ]` on a
running background row stops it with `TaskStop`.

## Install

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
| `openOnStart` | false   | Open the pane when the session starts                     |
| `maxCalls`    | 50      | Calls kept, the oldest finished dropped first             |
| `quietMin`    | 5       | Minutes without new output before a running call is quiet |
| `hangMin`     | 10      | Minutes without new output before a running call is hung  |
| `statusLine`  | true    | Show the status line                                      |

`/shell-flow clear` forgets finished calls; `/shell-flow stop` closes the pane.

## How it works

| Event / timer             | What shell-flow does                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `session.start`           | Registers `/shell-flow`, starts the 1 s tick and 2 s poll (again after a hot reload)         |
| `tool.call` (Bash)        | Records the call (label from the input `description`), awaits it, records exit and output    |
| `session.append`          | A `<task-notification>` row settles its background call (status, exit code)                  |
| tick, every 1 s           | Advances elapsed time and redraws the status line                                            |
| poll, every 2 s           | `fs.stat` of the watch or output file → freshness, quiet, hung; `tail -n 40` for runner rows |
| `ui.render` (Pane)        | Draws the pane; the selected row's tail is read once when it is selected                     |
| `ui.close`, `command.run` | Opens and closes the pane                                                                    |

A runner is a command whose executable (past `NAME=value` and `cd … &&`,
after a guard's `--`, or inside `bash -c '…'` / `sh -c "…"`) is `codex`,
`pi`, `devin` or `ocr`. Its live output is the guard's `--watch-file`, or its
own absolute stdout redirect (`> /path/run.log`); the guard's verdict is read
from the Bash output once the run ends. shell-flow sees the command as the
model wrote it, before a `PreToolUse` settings hook wraps it, and recognises
both forms. A `TaskStop` (the model's or the pane's) settles its call as
stopped; an interrupted call is stopped, not failed. Every hook passes its
event on unchanged.

## Privacy

No network, no telemetry. It reads only the output and watch files of this
session's own Bash calls, and keeps its list in the session's memory.
