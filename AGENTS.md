# Agent guidance

This Claude Code mod observes delegated shell runs, background tasks and their
verdicts. Read [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md) and
[SECURITY.md](SECURITY.md).

- Runtime hooks live in `hooks/`, the pure model in `hooks/model/`, and behavior
  tests in `tests/`. Preserve the separate strict model lint pass and the
  distinction between a live process, a stalled run and a completed verdict.
- Use `npm ci` and `npm run check`; runtime pins are in `.nvmrc` and
  `package.json`. Refresh engine declarations with `npm run update-types` while
  retaining their provenance in `engine-types/NOTICE.md`.
- Unit tests make no network calls. Live `eval` and `smoke:live` checks use a
  Claude login; a headless command check cannot establish that the status line,
  pane or background verdict is visible. Follow CONTRIBUTING's manual recipes.
- Follow CONTRIBUTING and `docs/adr/0001-night-factory-autonomy.md` for factory
  boundaries, protected paths, stopping automation and `needs-human` handling.
  Use an allowed commit scope such as `docs(repo): ...` and the existing hooks.
