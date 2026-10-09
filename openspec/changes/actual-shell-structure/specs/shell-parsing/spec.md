## ADDED Requirements

### Requirement: Executable identity

The plugin SHALL classify only an actual static executable in a supported simple command, list, conditional chain, pipeline or recognized wrapper. It SHALL preserve leading Assignment nodes, absolute/quoted/assembled literal names and the codex/pi/devin/ocr set. It SHALL NOT mine operators, runner names or terminators from ordinary argv.

#### Scenario: Quoted examples stay data

- WHEN `echo 'example; codex exec task'` or `printf '%s' -- codex` starts
- THEN runner, prompt and watched path are unknown.

#### Scenario: Assignment provenance

- WHEN `FOO=1 BAR='x y' co"dex" exec go` starts
- THEN the runner is codex.
- WHEN `'FOO=1' codex exec go` starts
- THEN the quoted first word is an executable and the runner is unknown.

#### Scenario: Finite wrappers

- WHEN sh/bash/zsh receives a static script via -c or a short cluster consisting only of a/e/f/n/u/v/x/l/c and containing c
- THEN only that script is parsed, up to four wrapper levels; subsequent argv remains data.
- WHEN direct w/agent-runner-guard or node followed by a w.ts/guard.ts/watchdog.ts basename receives its genuine --
- THEN child argv is interpreted directly; only an actual child shell -c recurses into source.

### Requirement: Watched path ownership

A watched path SHALL come from a recognized guard's actual --watch-file option before its terminator, or the selected runner's single absolute stdout redirect / immediate tee [-a] receiving its incoming pipe. Explicit relative guard paths SHALL remain supported without a known child runner. Ambiguous or unresolved routing SHALL return unknown.

#### Scenario: Prompt markers

- WHEN `codex exec 'explain | tee /audit/not-a-file'` starts
- THEN runner is codex, prompt is literal label data, and no watched path is inferred.

#### Scenario: Associated output

- WHEN `pi -p 'list mods' 2>&1 | tee /t/pi.log` starts
- THEN watched path is /t/pi.log.
- WHEN `pi -p go; ls > /t/list`, `pi -p go 2> /t/error`, or `pi -p x | cat > /t/other | tee /t/out` starts
- THEN watched path is unknown. Arbitrary intermediary commands do not establish a runner-output route; an already known own stdout target remains authoritative.

#### Scenario: Tee stdin ownership

- WHEN `pi -p x | tee /t/watch < /t/unrelated`, fd 0 duplication/closure, or tee here-input replaces its incoming pipe
- THEN the tee file SHALL NOT be inferred as the runner output. File/descriptor redirection and here-input that override tee stdin SHALL prevent inference from that tee. Input/stderr/descriptor duplication, prompt markers and unrelated commands SHALL NOT supply a polling path.
- WHEN an ordinary adjacent tee or tee -a only changes stderr
- THEN the actual absolute tee output SHALL remain supported.

#### Scenario: Explicit generic guard

- WHEN `w --watch-file rel.log` or `node guard.ts --watch-file /t/g.log -- ./new-agent run` starts
- THEN the explicit path keeps the call in the existing runner scope even without a known runner.

### Requirement: Prompt argument ownership

Only the selected runner's initial -p operand, or codex's initial exec static prompt operand, SHALL supply the label. Unsupported option/positional forms SHALL remain unknown. The parser SHALL remove static quotes without resolving expansions. Labels SHALL retain six-word truncation and description precedence.

#### Scenario: Sibling flags

- WHEN `echo -p wrong; pi -p 'actual prompt'` starts
- THEN prompt is actual prompt.
- WHEN `pi -p '$HOME'` starts
- THEN prompt is literal $HOME.
- WHEN `pi -p "$HOME"` starts
- THEN runner is pi and prompt is unknown.

### Requirement: Conservative parsing and usable delivery

Parser errors/exceptions, unsupported dynamic/control-flow nodes and unresolved relevant words SHALL never fall back to raw-source matching. The maintained parser SHALL ship relative ESM/declaration/license/provenance bytes checked against its pinned acquisition. Actual current SDK scanner, module loading and public parsing SHALL pass independently of Node-only proof.

#### Scenario: Native packaged graph

- WHEN the real SDK scans and loads shipped relative parser modules
- THEN the unmodified cyclic graph and public lazy word parsing are usable with no Node/DOM/WASM/eval or bare npm import.
