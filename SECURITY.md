# Security policy

## Supported versions

Only the latest release of agent-shell-watch is supported.

## Reporting a vulnerability

Please report privately through
[GitHub Security Advisories](https://github.com/apolenkov/agent-shell-watch/security/advisories/new).
Do not open a public issue. You will get an answer within 7 days.

## What agent-shell-watch does on your machine

The runtime plugin observes this session's Bash calls. It reads the supported
session transcript and the output/watch files of watched calls, using
`tail -n 40` for output tails. Pressing its stop button invokes `TaskStop`.

Limits and usage displays also access existing local state:

- `~/.local/state/executor-limits/<name>`: executor block-until timestamps.
- `~/.codex/sessions`: today's and yesterday's rollout directories. Limits read
  the last 65,536 bytes of up to three recent rollouts; usage reads the same
  bounded tail of the session selected for an eligible Codex run.
- `~/.pi/agent/sessions`: directory listings and modification times identify
  candidate session directories. Usage reads the last 262,144 bytes of the
  selected session file and marks totals as partial when the file is larger.

These global session files can belong to other workspaces. Attribution uses a
call's start-time window because its cwd is unknown. Pi requires a single
candidate; Codex chooses the nearest start, which can be a neighbouring run.
With no known values, usage displays a dash. If a later read finds nothing or
attribution becomes ambiguous, the previous numbers are retained; a displayed
number does not guarantee successful attribution on the latest refresh.

Limits are read only while the runners view is open or a runner is live, at
most every 30 seconds. Usage is read while that view is open, at most every
30 seconds per run, for runs selected to fit the maximum 30-row pane. A smaller
pane or an expanded row can hide some selected runs. The call list and derived display state
stay in session memory. The two durable preferences are `paneOpen` (whether
the pane was left open) and `view` (agents or runners).

The runtime plugin makes no network requests and collects no telemetry.
Repository CI and night-factory workflows are separate automation; their
networked checks and agents are described in [CONTRIBUTING.md](CONTRIBUTING.md)
and [the factory ADR](docs/adr/0001-night-factory-autonomy.md).
