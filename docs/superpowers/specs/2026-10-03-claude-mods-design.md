# claude-mods design (2026-10-03)

Design of shell-flow (function hooks, early access, Claude Code 2.1.288+). Written when shell-flow and council
shared the claude-mods repository; council's section now lives in apolenkov/claude-council.
Owner decisions: backlog TASK-244, decision-104, research doc-235 (OpenCodeReview).

## Shared conventions

- Layout per mod, after `anthropics/claude-code/mods`: `.claude-plugin/plugin.json`, `hooks/hooks.json`
  naming one module, TypeScript under `hooks/`, tests under `tests/` named for the file they cover,
  shared test helpers one export per file under `tests/fixtures/`.
- Pure model in plain `.ts` files (no `$`), a thin hooks/render layer on top. The model is tested
  directly; the hooks through the engine (`claude plugin test`).
- State a drawing reads lives in `$.state` (`atom`/`read`/`update`, contract in `types/index.d.ts`,
  `"types"` in plugin.json), never in module variables: a hot reload drops those.
- Work that outlives a dispatch is started on `$.clock.after/every`, never awaited inside a hook.
- Every observing hook passes its event on unchanged (`return next(e)` / the awaited result).
- No telemetry. Network only where stated (council's member CLIs; Jev when configured).
- Typecheck: `npm run typecheck` against `types/claude-code.d.ts` (2.1.288).

## shell-flow

**Goal.** At a glance, without opening anything, the owner sees that work is moving: time is ticking,
output is fresh, nothing failed. Today the footer says only "1 shell".

**Scope.** This session only: Bash calls of the main loop and of every subagent, background tasks,
and external agent runs (Pi, Codex, Devin, OpenCodeReview) launched from this session.

### Data (model.ts)

`ShellCall { id (tool_use_id), agentId?, source ('main' | subagent type/description | 'bg'),
description, command, startedAt, endedAt?, exitCode?, interrupted?, background: boolean,
taskId?, outputPath?, watchPath?, runner? ('codex'|'pi'|'devin'|'ocr'), verdict? (DONE n |
RATE_LIMIT epoch | STALLED reason | BUSY pid file), lastOutputAt?, outputBytes?, tail: string[] (≤ 40),
status: 'running' | 'quiet' | 'hung' | 'done' | 'failed' | 'stopped' }`

- Label comes from the tool input `description` (fallback: first 60 chars of `command`) — the
  agent-flow defect (labels not from input) must not repeat.
- Source: `agentId` → subagent; map agentId to its type/description from `agent.spawn` events when
  available, else `agent <id>`.
- Background: Bash result `backgroundTaskId` + the path parsed from the result `text`
  (`Output is being written to: <path>`; verified on real transcripts).
- Runner: command matches `\b(codex|pi|devin|ocr)\b` as the executable; `--watch-file <path>` (or
  `--watch-file=<path>`) gives `watchPath`. Verdict = last non-empty output line matching
  `^(DONE \d+|RATE_LIMIT \d+|STALLED \S+|BUSY \d+ \S+)$` (agent-viewer guard), else exit code.
- Liveness thresholds (same as agent-viewer `classify.ts`): quiet after 5 min without new output,
  hung after 10 min. Both in `userConfig` (`quietMin`, `hangMin`).
- Keep the last `maxCalls` (default 200), oldest finished dropped first.

### Behaviour

- `tool.call` on `Bash`: record at call, `await next(e)`, record the result, return it unchanged.
- Liveness poller: `$.clock.every(2000)` while any call is running and has an output/watch file:
  `$.fs.stat` (size, mtime) → `lastOutputAt`, status running/quiet/hung. Tail (`$.fs.read`, last 40
  lines) is read only while the pane is open, every 1 s for the selected/visible running rows.
- Status line, always on while anything runs or the last call failed in the past 2 minutes
  (`$.ui.status`, cleared otherwise):
  `shell: ◐ Run e2e tests 2:13 · output 4s ago` · `+N bg` · `⚠ quiet 6m` · `✗ Typecheck exit 2`.
  The most urgent item first: hung > failed > quiet > running.
- Pane `/shell-flow` (`clear`, `stop`): one row per call — status glyph (◐ running, ● done,
  ✗ failed, ⚠ quiet/hung, ○ stopped), elapsed, source, label, command (cut to width), exit code or
  verdict. Running rows show `output Ns ago`. Buttons: `[ background only ]` toggle, `[ clear ]`,
  `[ close ]`; a running background row has `[ stop ]` → `$.tool.call({ tool: 'TaskStop', task_id })`.
  Selecting a row expands: full command, tail (40 lines), stderr, output path.
- `userConfig`: `columns` (52), `openOnStart` (false), `maxCalls` (200), `quietMin` (5), `hangMin` (10),
  `statusLine` (true).

### Tests

Model: label fallback, source mapping, background path parse, runner + watch-file detection, verdict
parse, liveness classification, trimming. Engine: a Bash call through `tool.call` appears and finishes;
a background result yields `outputPath`; the poller with `mock.clock` and a mocked `fs.stat` moves
running → quiet → hung; the status line text; pane render on `terminal` and `desktop`; filter toggle;
stop presses `TaskStop`.

## Revisions after spec review (Fable, 2026-10-04) — these override the sections above

Files: hooks module `hooks/register.tsx`; pure model `hooks/model/*.ts` (functional strict);
effects `hooks/effects/*.ts`; views `hooks/view/*.tsx`; each mod has `version.txt` for release-please.

shell-flow

- Tail via `$.process.run(['tail','-n','40',path])` for visible running rows only while the pane
  is open; `$.fs.read` rejects files > 4 MiB. Tails are not kept in `$.state` (4 MiB JSON cap).
- `$.fs.stat` rejects a missing path: a missing output/watch file means `lastOutputAt = startedAt`.
- Background path regex accepts both phrasings ("running in background with ID" and "was moved to
  the background"); the path ends before a trailing period.
- Subagent labels from `$.agent.list()` (`AgentSpawnInput` carries no agentId).
- Runner = first command token after env assignments and `cd … &&`; `echo pi` does not match.
- `maxCalls` default 50. A (re)load restarts the poller when state holds running calls.
- Runner rows are the primary scenario (owner: ordinary subagents are already shown by Claude Code).

council

- `ocr` is installed on the owner's machine (v1.12.11); all four adapters are live-checkable.
- argv: `codex exec review --uncommitted --ephemeral -o <file>`; `pi -p --mode json --no-session
--no-tools <prompt>`; `devin -p --permission-mode auto --respect-workspace-trust false <prompt>`
  (explicit read-only mode: an env default may be `dangerous`); `ocr review --format json --audience agent`.
- `$.process.spawn` streams member output; no `process.run` fallback.
- `autoReview` defaults to `off` (paid CLIs); the owner enables `notify` in settings. Council-level
  single-flight, empty diff skipped, a new `prompt.submit` cancels a scheduled auto-run.
- Untracked files: `git ls-files --others --exclude-standard`, binaries and files > 64 KB skipped,
  secret-like names (`.env*`, `*.pem`, `*.key`, `*secret*`, `*credential*`) never sent.
- Detection by `<bin> --version` signature, not bare `command -v`. Limit files hold epoch seconds.
- Jev limits (≤ 9 questions, ≤ 14k chars) are the owner's rule (doc-016), not API limits; key sent
  as an `Authorization: Bearer` header through `$.http.fetch`.
- Tests: `mock` covers clock/store/env only; other nouns are answered by `on(...)` hooks.

CI

- `npm ci --ignore-scripts`, then only Claude Code's own postinstall; Claude Code pinned as a
  devDependency. Renovate PRs run on the hosted runner. Fork PRs need maintainer approval
  (repository Actions setting, applied at publication).
