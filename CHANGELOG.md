# Changelog

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
