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

It never changes `.github/`, git hooks, check configuration, existing tests, or
names and scripts of dependencies; it only adds the reproduction test. A patch
that does is thrown away and the finding becomes `needs-human`. The agents have no
shell, and the LLM token never reaches a job that can write.
