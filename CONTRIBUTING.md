# Contributing

## Setup

```sh
npm ci            # installs tooling and the git hooks (lefthook)
npm run check     # format, typecheck, lint, repo lint, validate, tests
```

agent-shell-watch needs Claude Code 2.1.287+ (mods are on by default). Try it live with
`claude --plugin-dir .` from the repository root.

## Rules of the house

- TypeScript at its strictest (`tsconfig.json`), ESLint with no warnings and no
  unexplained suppressions (a second pass with inline config off refuses them).
- No mutation, no `let`, no loops, no classes. `hooks/model/` is pure and
  held to `eslint-plugin-functional`'s strict preset.
- Files ≤ 250 lines, functions ≤ 40, complexity ≤ 12.
- Every behaviour has a test under `tests/`, named for the file it covers, run by
  `claude plugin test`. No network in tests.
- [Conventional Commits](https://www.conventionalcommits.org) with a scope:
  `agent-shell-watch`, `repo`, `deps`, `ci`. Releases are cut by release-please.
- After a Claude Code update: `npm run update-types`, then `npm run check`.

`npm run lint` lints the pure model in its own ESLint process: eslint-plugin-functional
caches type immutability per type, not per rule level, so linting `hooks/` (lite) and
`hooks/model/` (strict) in one process would make the result depend on file order.

## Live checks (manual)

`npm run eval` runs `claude plugin eval` over `evals/`: each case is a real
headless (`claude -p`) session with only this plugin loaded. It covers what the
unit tests cannot: that the hooks module loads in the engine and registers its
command (`/shell-watch clear` answers), and that a plain Bash turn goes through
untouched with the mod on. It costs about $0.07 and half a minute.

Locally it needs your Claude login or an API key. In CI the `eval` job runs it
when the repository has the secret `ANTHROPIC_API_KEY`; without the secret
(a fork, a Dependabot run, no key yet) the job skips its steps and stays green,
so until someone adds the key this is a local step, not an automatic check.

It cannot see the status line, the pane or a background runner's verdict (a
headless session draws none); those are checked by hand in an interactive
session.

## Dependency holds

- `typescript` stays on 6.x (6.0.3): `typescript-eslint` 8.71.0, its latest,
  declares the peer `typescript >=4.8.4 <6.1.0`. Take TypeScript 7 once it widens
  that range; drop the Dependabot `ignore` for `typescript` then.

## CI autofix

When `ci` fails on a Dependabot PR (or on your own PR labelled `autofix`),
`.github/workflows/ci-autofix.yml` asks an OpenCode Go agent for a patch from the
failure log. Two attempts per PR (commits carrying an `Autofix-Attempt:` trailer),
then the PR gets `needs-human` and auto-merge is switched off. The agent has no
shell and cannot change `.github/`, hooks, check configuration or secrets; a patch
that does is thrown away. After `needs-human` a person takes over: the attempt
count stays with the PR, so the bot will not try a third time.

Labels: `autofix` opts one of your own PRs in; the bot sets `needs-human` when it stops.

The autofix bot never changes workflows, hooks, lint config or the scripts in `package.json`.

`scripts/autofix-report.sh [owner/repo] [days]` reports what Dependabot PRs and the bot did
over the last days (clean merges, fix commits, `needs-human`, incidents) and says whether
the observation criterion (3 clean Dependabot PRs, 0 incidents) is met.

## Night fix

The nightly `ocr scan` (night-review) finds things, and about half of its "critical"
findings are false. `.github/workflows/night-fix.yml` therefore verifies every
finding (up to 3 per scan: critical or high, bug or security) before it changes
anything:

- `confirmed`: a reproduction test, `tests/night-fix/<id>/repro.test.ts`, fails on
  current main. Only then does an agent fix it and the fix goes up as a PR
  (branch `night-fix/<id>`, label `night-fix`), which the autofix bot and
  auto-merge treat like a Dependabot PR: required checks, at most two attempts in
  total (the first commit already carries `Autofix-Attempt: 1`), then `needs-human`.
- `refuted` (the code lines that disprove it are cited) and `needs-human`
  (anything else, also real-looking but untestable): no change, one line in the
  comment of the run on the issue "Night review findings".

Issues: a `confirmed` or `needs-human` finding gets one issue (labels `night-finding`,
`ocr-scan`, `severity:*`), found again by the fingerprint on its first line
(`<!-- night-fp: ... -->`: path, category and the whitespace-collapsed code, not the line
numbers or the model's wording). The fix PR says `Fixes #N`, so merging it closes the
issue. A refuted finding or a run with no verdict (the verifier ran out of steps, no
valid `verdict.json`) gets no issue. When a complete scan (under 90% of its token
budget) no longer reports a finding, its open issue is closed with the label
`scan-closed`; if the finding comes back, that issue is reopened. Do not dispatch
night-fix while a scheduled run is going: both could open the same issue.

The comment of a run also states the tokens it spent (scan, verify, fix agents).

It never changes `.github/`, git hooks, check configuration, existing tests, or
names and scripts of dependencies; it only adds the reproduction test. A patch
that does is thrown away and the finding becomes `needs-human`. The agents have no
shell, and the LLM token never reaches a job that can write.
