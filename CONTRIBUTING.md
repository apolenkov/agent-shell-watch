# Contributing

## Setup

```sh
npm ci            # installs tooling and the git hooks (lefthook)
npm run check     # format, typecheck, lint, repo lint, validate, tests
```

shell-flow needs Claude Code 2.1.288+ with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. Try it live with
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
  `shell-flow`, `repo`, `deps`, `ci`. Releases are cut by release-please.
- After a Claude Code update: `npm run update-types`, then `npm run check`.

`npm run lint` lints the pure model in its own ESLint process: eslint-plugin-functional
caches type immutability per type, not per rule level, so linting `hooks/` (lite) and
`hooks/model/` (strict) in one process would make the result depend on file order.
