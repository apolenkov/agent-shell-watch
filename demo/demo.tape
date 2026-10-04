# Records demo/demo.gif: `vhs demo/demo.tape` from the repository root.
# Needs Claude Code 2.1.287+ with shell-flow installed.
# demo/bin/codex and demo/bin/tsc are stand-ins so the recording is free and
# repeatable. Run from a trusted, empty project at /tmp/my-app. The recorded
# session loads no personal instructions (agents-md managed-only), no status
# line command and no council.

Output demo/demo.gif

Require claude

Set Shell "zsh"
Set FontSize 15
Set Width 1280
Set Height 560
Set Padding 16
Set Theme "Catppuccin Mocha"
Set TypingSpeed 25ms

Hide
Type `unset CLAUDE_CODE_CHILD_SESSION CLAUDECODE; export PATH="$PWD/demo/bin:$PATH"; cd /tmp/my-app; clear`
Enter
Type `claude --settings '{"statusLine":{"type":"command","command":"true"},"enabledPlugins":{"council@claude-mods":false},"pluginConfigs":{"agents-md@builtin":{"options":{"instructionFiles":"managed-only"}}}}'`
Enter
Sleep 8s
Show

Type "Run in the background: codex exec review --uncommitted (description: Review diff). Then run: tsc --noEmit (description: Typecheck). Only run them."
Sleep 500ms
Enter
Sleep 14s

Type "/shell-flow"
Sleep 400ms
Enter
Sleep 4s

Sleep 6s
Type "1"
Sleep 8s

Escape
Sleep 4s
