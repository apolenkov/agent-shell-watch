# Records demo/demo.gif: `vhs demo/demo.tape` from the repository root.
# Needs Claude Code 2.1.295+ and a login. Loads the mod from this checkout
# (--plugin-dir), so the recording shows the code in the repository.
# demo/setup.sh builds the sandbox: an empty project at /tmp/my-app and a
# throwaway HOME at /tmp/my-app-home with synthetic runner limits; the stand-ins
# in demo/bin (codex, pi, devin, tsc) write synthetic session files and print
# the runner guard's verdicts, so the recording is free and repeatable. No user
# settings, personal instructions, status line command or other mods are loaded.

Output demo/demo.gif

Require claude

Set Shell "zsh"
Set FontSize 15
Set Width 1400
Set Height 600
Set Padding 16
Set Theme "Catppuccin Mocha"
Set TypingSpeed 15ms
Set Framerate 12

Hide
Type `unset CLAUDE_CODE_CHILD_SESSION CLAUDECODE; REPO=$PWD; sh demo/setup.sh; export PATH="$REPO/demo/bin:$PATH" HOME=/tmp/my-app-home; cd /tmp/my-app; clear`
Enter
Type `claude --model haiku --plugin-dir "$REPO" --setting-sources project,local --settings '{"permissions":{"allow":["Bash"]},"statusLine":{"type":"command","command":"true"},"pluginConfigs":{"agent-shell-watch@inline":{"options":{"columns":72}},"agents-md@builtin":{"options":{"instructionFiles":"managed-only"}}}}'`
Enter
Sleep 8s
# Clears the launch command off the screen.
Ctrl+L
Sleep 1s
Show

Type "In one turn, run three Bash calls in parallel. Background (run_in_background): codex exec review --uncommitted (description: Review diff). Foreground: pi -p 'fix flaky test' (description: Fix flaky test) and devin -p 'migrate config' (description: Migrate config). Only run them."
Sleep 500ms
Enter
# Cuts the model's wait: on until the mod's status line is up.
Hide
Wait+Screen@60s /agent-shell-watch:/
Show
Sleep 4s

Type "/shell-watch"
Sleep 400ms
Enter
Sleep 5s

Type "/shell-watch runners"
Sleep 400ms
Enter
Sleep 7s

Escape
Sleep 1s
