# Rollout kit: ci-autofix and night-review (TASK-282.4)

One shot after the observation: `scripts/rollout-all.sh --apply`. Nothing here is applied before
the gate is open.

## What lands in each repository

Two files, rendered from `main` of agent-shell-watch with the settings of `<repo>.conf`, in one PR
(branch `ci/autofix-rollout`, auto-merge on), plus the labels `needs-human` and `autofix`:

| File                                 | What it is                                                    |
| ------------------------------------ | ------------------------------------------------------------- |
| `.github/workflows/ci-autofix.yml`   | an OpenCode Go agent repairs a red Dependabot PR (2 attempts) |
| `.github/workflows/night-review.yml` | nightly OCR review; low and style findings go to one summary  |

`night-fix.yml` and `.github/scripts/night-*.sh` are not rolled out: they are the pilot of TASK-282.6
(findings to issues, a fix per issue). Rollout needs the secret `OCR_LLM_AUTH_TOKEN` in environment
`ci` or in the repository; the preflight checks it.

## What differs per repository

| Repository           | CI workflow | Fixable job(s)            | CodeQL workflow | Node setup         | Own protected paths (on top of the pilot's)     |
| -------------------- | ----------- | ------------------------- | --------------- | ------------------ | ----------------------------------------------- |
| agent-mods           | `ci`        | `check`                   | `codeql`        | `.nvmrc`           | `.claude-plugin/*`                              |
| jev-codex-router-lab | `CI`        | `verify`                  | `codeql`        | `node-version: 20` | `openspec/*`, `fixtures/*`, `artifacts/*`, docs |
| feynman              | `CI`        | `Test (Node .+ on .+)` x6 | `codeql`        | `node-version: 24` | installers, `openspec/*`, `.agents/*`, ADRs     |
| agent-autopilot      | `ci`        | `check`                   | `codeql`        | `.nvmrc`           | release-please files, `hooks/hooks.json`, types |
| agent-runner-guard   | `ci`        | `check`                   | `codeql`        | `.nvmrc`           | `.editorconfig`, `.gitignore`                   |

multitracker is on hold (another session works there): `HOLD=` in its conf makes the preflight refuse.
agent-autopilot has another session at work (release 0.2.0): tell the coordinator before its turn.

## Order and stops

1. `scripts/rollout-all.sh` (dry run): preflight and render and `actionlint` for every target, then
   the gate. Fix every `PROBLEM` first.
2. Gate: agent-shell-watch, agent-compact-advisor and agent-council together show at least 3 clean
   Dependabot PRs, 0 incidents and 0 suspects (`scripts/autofix-report.sh <owner/repo> 14`). Closed gate, no `--apply`.
3. `scripts/rollout-all.sh --apply`: per target apply, wait for the PR to merge (it updates the branch
   when BEHIND), check `ci-autofix.yml` is on main, clean up, next. The first problem stops it with
   `STOP: ...`; re-run after fixing, finished targets are skipped.
4. After each target's first Dependabot PR: `scripts/autofix-report.sh apolenkov/<repo> 14`.

## Not proven yet

The `--apply` path has not run on any repository; only the dry run and the pieces of it were.
The first target (agent-mods) is the real test: watch it before leaving the driver alone.
