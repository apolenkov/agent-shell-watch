# Security policy

## Supported versions

Only the latest release of agent-shell-watch is supported.

## Reporting a vulnerability

Please report privately through
[GitHub Security Advisories](https://github.com/apolenkov/agent-shell-watch/security/advisories/new).
Do not open a public issue. You will get an answer within 7 days.

## What agent-shell-watch does on your machine

agent-shell-watch only observes: it reads the session's transcript and the output
files of the session's own Bash calls, runs `tail -n 40` on those files, and
runs nothing else except `TaskStop` on a press of its stop button. It stores
one value across sessions: whether the pane was left open.
Nothing leaves your machine; there is no telemetry and no network call.
