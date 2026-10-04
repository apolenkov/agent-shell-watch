# Changelog

## [0.2.0](https://github.com/apolenkov/claude-mods/compare/shell-flow-v0.1.0...shell-flow-v0.2.0) (2026-10-04)


### ⚠ BREAKING CHANGES

* **shell-flow:** the [ background only ] button and its f hotkey are removed.

### Features

* **shell-flow:** /shell-flow always takes the keys; the first row holds the focus ([7c848b4](https://github.com/apolenkov/claude-mods/commit/7c848b4e5bd41cd4d2aed71354835e677a9fd3ff))
* **shell-flow:** a runner's tee is its watch file; label a runner by its prompt ([040b0eb](https://github.com/apolenkov/claude-mods/commit/040b0eb8f9a0291ce898ccaeb78fca62716f5e4b))
* **shell-flow:** backfill calls made before the mod loaded ([578c031](https://github.com/apolenkov/claude-mods/commit/578c0318ab8f58561febf400710e5994e58bba76))
* **shell-flow:** drop the background-only filter ([2d5acb0](https://github.com/apolenkov/claude-mods/commit/2d5acb072d8388fdfcf8884632a4a8de4c85c52c))
* **shell-flow:** layout model: one-line text, width cut, pane order, height fit ([798d895](https://github.com/apolenkov/claude-mods/commit/798d895ed282d818b722a48b54ec05e173fb7b07))
* **shell-flow:** model to rebuild Bash calls from the transcript ([b5edf78](https://github.com/apolenkov/claude-mods/commit/b5edf780f99ffdab2f5100d4c37e29e81e58cf3b))
* **shell-flow:** pane rows lead with state, carry a note, and answer hotkeys ([1067ced](https://github.com/apolenkov/claude-mods/commit/1067ceddae713c7c91cc7a563e8e60e14bb9bb67))
* **shell-flow:** remember across sessions whether the pane was left open and its filter ([5bdb753](https://github.com/apolenkov/claude-mods/commit/5bdb75359fac3c5797168eb1fe2e812ee7cfeafa))
* **shell-flow:** row state before the label, a note per row, 'no output' while silent ([2275f62](https://github.com/apolenkov/claude-mods/commit/2275f62de29e2522d37c85d50d6bc103f9b2c22e))


### Bug Fixes

* **shell-flow:** an open pane keeps every running row's last line fresh ([9b0af5f](https://github.com/apolenkov/claude-mods/commit/9b0af5f7a0b20543e59f5153424918df6517772a))
* **shell-flow:** backfill replays TaskStop, merges in transcript order, keeps clear ([cc8321f](https://github.com/apolenkov/claude-mods/commit/cc8321f3a9816ca42efd1bb303ff76b9bcda7b65))
* **shell-flow:** drop the own shell: prefix from the status line ([a8868f9](https://github.com/apolenkov/claude-mods/commit/a8868f96fdbeb6e3e5c58d96521959480533a510))
* **shell-flow:** labels carry their keys; replies without our own prefix ([dfcc326](https://github.com/apolenkov/claude-mods/commit/dfcc326b507775d99c85c211deabee26292c4ee4))
* **shell-flow:** one-line rows cut to the pane, live and newest first, +N older ([fb8e813](https://github.com/apolenkov/claude-mods/commit/fb8e813e65ad6b5773d577eb5332f6257e5c80cd))
* **shell-flow:** short of height, rows go compact before any is hidden ([537452b](https://github.com/apolenkov/claude-mods/commit/537452bc8ec1359842c402170a3a2a219a555941))
* **shell-flow:** text-only answers are output; read every notification in a message ([3552902](https://github.com/apolenkov/claude-mods/commit/355290299ece3724653ec158cbb2fdd491fe7e4e))

## 0.1.0 (2026-10-04)


### Features

* **shell-flow:** model for notices, outcomes, polling and config ([c20b1b8](https://github.com/apolenkov/claude-mods/commit/c20b1b818595825ab69d16bd1012218641361078))
* **shell-flow:** pure model for Bash calls, runners and liveness ([324d82c](https://github.com/apolenkov/claude-mods/commit/324d82c42c38845767923b1e0d1adbf3c9cff3b4))
* **shell-flow:** status line text, runner detection past env and cd ([6f782de](https://github.com/apolenkov/claude-mods/commit/6f782de1b21e1e227e065b347ddf197e3b46cb8a))
* **shell-flow:** status line, liveness poller and pane with filter and stop ([c3b4384](https://github.com/apolenkov/claude-mods/commit/c3b4384e8fc5e26538e5e6da4cec79677cc9b0d1))


### Bug Fixes

* **shell-flow:** a [ ▸ ] button leads each row, so the keyboard can expand it ([c7c161c](https://github.com/apolenkov/claude-mods/commit/c7c161c142c32acc99e300e179f71203952151c4))
* **shell-flow:** a call refused before it ran is denied, never a failure ([6932ffa](https://github.com/apolenkov/claude-mods/commit/6932ffa0cd7d183b9ac95797dbd8ac3e09a673d8))
* **shell-flow:** a successful TaskStop settles its background call ([cb520c3](https://github.com/apolenkov/claude-mods/commit/cb520c3f35132b380a73d26781fc1e88df0f1a94))
* **shell-flow:** count the rest of the status line as +N ([2d5494e](https://github.com/apolenkov/claude-mods/commit/2d5494ed21a78add53cccda0e07487dc85dc47af))
* **shell-flow:** find runners inside shell wrappers; a runner's redirect is its watch file ([aa8e0b7](https://github.com/apolenkov/claude-mods/commit/aa8e0b789084157433864164a3edc2c1d027f91f))
* **shell-flow:** interrupted calls stop, no invented exit code, finished bg output read once more ([8cf57fc](https://github.com/apolenkov/claude-mods/commit/8cf57fcbe13a05c75eab448fe0811237e628a1a9))
* **shell-flow:** read live runner progress from the watch file ([2071caf](https://github.com/apolenkov/claude-mods/commit/2071cafa4c71ccd0e5f165ffa98cd873fb2f4e79))
