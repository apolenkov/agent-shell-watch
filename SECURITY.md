# Security policy

## Supported versions

Only the latest release of each mod is supported.

## Reporting a vulnerability

Please report privately through
[GitHub Security Advisories](https://github.com/apolenkov/claude-mods/security/advisories/new).
Do not open a public issue. You will get an answer within 7 days.

## What the mods do on your machine

- **shell-flow** only observes: it reads the output files of the session's own
  background tasks and never runs a command except `TaskStop` on a press of its
  stop button.
- **council** runs the reviewer CLIs you have installed (`codex`, `pi`, `devin`,
  `ocr`) on your working diff. Each sends that diff to its own model provider.
  With `summarizer: "jev"` the findings are sent to TypeSafe (api.typesafe.ai).
  Nothing else leaves your machine; there is no telemetry.
