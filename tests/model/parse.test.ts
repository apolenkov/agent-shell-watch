import { expect, test } from "claude-code/testing";

import {
  exitCodeOf,
  labelOf,
  lastLines,
  noticesOf,
  outputPathOf,
  promptWordsOf,
  runnerOf,
  verdictOf,
  watchPathOf,
} from "../../hooks/model/parse.ts";

const BG_TEXT =
  "Command running in background with ID: b3tme16m8. Output is being written to: /work/s1/tasks/b3tme16m8.output. You will be notified when it completes.";

test("label comes from the description, else the command's first 60 chars", () => {
  expect(labelOf("Run e2e tests", "npm run e2e")).toBe("Run e2e tests");
  expect(labelOf("  ", "npm test")).toBe("npm test");
  expect(labelOf(undefined, `echo ${"x".repeat(80)}`)).toHaveLength(60);
});

test("background output path is parsed from the result text", () => {
  expect(outputPathOf(BG_TEXT)).toBe("/work/s1/tasks/b3tme16m8.output");
  expect(
    outputPathOf(
      "Command was moved to the background (ID: b2). Output is being written to: /work/s1/tasks/b2.output.",
    ),
  ).toBe("/work/s1/tasks/b2.output");
  expect(outputPathOf("hello")).toBeUndefined();
});

test("runner is the executable, not a word in an argument", () => {
  expect(runnerOf("codex exec 'fix it'")).toBe("codex");
  expect(runnerOf("node watchdog.ts --watch-file /t/x.log -- pi -p hi")).toBe(
    "pi",
  );
  expect(runnerOf("cd /w && /usr/local/bin/devin -p go")).toBe("devin");
  expect(runnerOf("ocr review --format json")).toBe("ocr");
  expect(runnerOf("FOO=1 BAR=x codex exec go")).toBe("codex");
  expect(runnerOf("cd /w/repo && pi -p fix")).toBe("pi");
  expect(runnerOf("echo pi")).toBeUndefined();
  expect(runnerOf("grep pi notes.txt")).toBeUndefined();
  expect(runnerOf("git commit -m 'codex'")).toBeUndefined();
  expect(runnerOf("git log")).toBeUndefined();
  expect(
    [
      "echo 'example; codex exec task'",
      "printf '%s' 'text && pi -p go'",
      "echo 'x | ocr review'",
      "printf '%s' -- codex",
      "echo -- pi",
      "'FOO=1' codex exec go",
      "1FOO=1 codex exec go",
      "codex exec 'broken",
      "f(){ codex exec go; }; f",
      "$RUNNER exec go",
      'echo "$(codex exec go)"',
      "(codex exec go)",
    ].map((command) => runnerOf(command)),
  ).toEqual(Array.from({ length: 12 }));
  expect(
    ["FOO=1 BAR='x y' codex exec go", "'codex' exec go", 'co"dex" exec go'].map(
      (command) => runnerOf(command),
    ),
  ).toEqual(["codex", "codex", "codex"]);
});

test("watch file is read from either spelling", () => {
  expect(watchPathOf("w --watch-file /t/a.log -- codex exec")).toBe("/t/a.log");
  expect(watchPathOf("w --watch-file='/t/b c.log' -- pi")).toBe("/t/b c.log");
  expect(watchPathOf("pi -p x")).toBeUndefined();
  expect(watchPathOf("codex exec go > /t/c.log 2>&1")).toBe("/t/c.log");
  expect(watchPathOf("pi -p x >> '/t/p q.log'")).toBe("/t/p q.log");
  expect(watchPathOf("pi -p x > rel.log")).toBeUndefined();
  expect(watchPathOf("ls > /t/list.txt")).toBeUndefined();
  expect(watchPathOf("w --watch-file /t/a.log")).toBe("/t/a.log");
  expect(
    watchPathOf("node guard.ts --watch-file rel.log -- ./new-agent run"),
  ).toBe("rel.log");
  expect(watchPathOf("agent-runner-guard --watch-file=/t/a.log -- pi")).toBe(
    "/t/a.log",
  );
  expect(watchPathOf("pi -p x 1>> /t/out 2>&1")).toBe("/t/out");
  expect(
    [
      "printf '%s' '--watch-file /audit/example.log'",
      "printf '%s' '--watch-file=/audit/example.log'",
      "codex exec '--watch-file=/audit/example.log'",
      "w '--watch-file /audit/example.log'",
      "w -- pi -p '--watch-file=/audit/example.log'",
      "pi -p x 2> /t/err",
      "pi -p x < /t/in",
      "pi -p x; ls > /t/list",
      "ls > /t/list; pi -p x",
      "pi -p x > /t/one > /t/two",
      "pi -p x > /t/one 1>&2",
      'pi -p x > "$HOME/out"',
    ].map((command) => watchPathOf(command)),
  ).toEqual(Array.from({ length: 12 }));
  expect(watchPathOf("w '--watch-file' '/t/a b.log'")).toBe("/t/a b.log");
});

test("verdict is the last non-empty line when it is a guard line", () => {
  expect(verdictOf(["working", "DONE 0", ""])).toBe("DONE 0");
  expect(verdictOf(["RATE_LIMIT 1790000000"])).toBe("RATE_LIMIT 1790000000");
  expect(verdictOf(["STALLED silence"])).toBe("STALLED silence");
  expect(verdictOf(["BUSY 42 /t/o.log"])).toBe("BUSY 42 /t/o.log");
  expect(verdictOf(["WAITING <что>"])).toBe("WAITING <что>");
  expect(verdictOf(["FAILED <почему>"])).toBe("FAILED <почему>");
  expect(verdictOf(["out", "WAITING approval for rm -rf", ""])).toBe(
    "WAITING approval for rm -rf",
  );
  expect(verdictOf(["FAILED harness crashed: boom"])).toBe(
    "FAILED harness crashed: boom",
  );
  expect(verdictOf(["WAITING approval", "", "[exited with code 78]"])).toBe(
    "WAITING approval",
  );
  expect(verdictOf(["DONE 0", "[exited with code 0]"])).toBe("DONE 0");
  expect(verdictOf(["out", "[exited with code 1]"])).toBeUndefined();
  expect(verdictOf(["WAITING"])).toBeUndefined();
  expect(verdictOf(["FAILED   "])).toBeUndefined();
  expect(verdictOf(["DONE 0", "more"])).toBeUndefined();
  expect(verdictOf([])).toBeUndefined();
});

test("exit code is read from an errored result's text", () => {
  expect(exitCodeOf("Exit code 2\nboom")).toBe(2);
  expect(exitCodeOf("Permission denied")).toBeUndefined();
});

test("last lines keep the tail and drop the trailing newline", () => {
  expect(lastLines("a\nb\nc\n", 2)).toEqual(["b", "c"]);
  expect(lastLines("", 2)).toEqual([]);
  expect(lastLines("a\nb\n[exited with code 78]\n", 2)).toEqual(["a", "b"]);
  expect(lastLines("[exited with code 0]\n", 2)).toEqual([]);
});

test("notices are read from row texts, the rest ignored", () => {
  expect(
    noticesOf([
      "hello",
      "<task-notification><task-id>t3</task-id><status>completed</status>",
    ]),
  ).toEqual([{ taskId: "t3", status: "completed" }]);
});

test("a task notification gives its task, status and exit code", () => {
  const text =
    '<task-notification>\n<task-id>b3tme16m8</task-id>\n<status>failed</status>\n<summary>Background command "x" failed with exit code 144</summary>\n</task-notification>';
  expect(noticesOf([text])).toEqual([
    { taskId: "b3tme16m8", status: "failed", exitCode: 144 },
  ]);
  expect(
    noticesOf([
      '<task-notification><task-id>t1</task-id><status>completed</status><summary>Background command "x" completed (exit code 0)</summary>',
    ]),
  ).toEqual([{ taskId: "t1", status: "completed", exitCode: 0 }]);
  expect(
    noticesOf([
      "<task-notification><task-id>t2</task-id><status>killed</status>",
    ]),
  ).toEqual([{ taskId: "t2", status: "killed" }]);
  expect(noticesOf(["plain text"])).toEqual([]);
});

test("a runner is found inside a shell wrapper, the guard's included", () => {
  expect(runnerOf("node w.ts -- bash -c 'codex exec review'")).toBe("codex");
  expect(
    runnerOf(
      String.raw`node '/w/watchdog.ts' --silence 600 --max-seconds 105 -- bash -c 'cd /r && pi -p '\''fix it'\'' > /t/p.log'`,
    ),
  ).toBe("pi");
  expect(runnerOf('sh -c "devin -p go"')).toBe("devin");
  expect(runnerOf("bash -lc 'ocr review'")).toBe("ocr");
  expect(runnerOf("bash -c 'echo pi'")).toBeUndefined();
  expect(runnerOf("bash -euc 'pi -p go'")).toBe("pi");
  expect(runnerOf("bash -cl 'ocr review' argv0 codex")).toBe("ocr");
  expect(runnerOf("node w.ts -- codex exec 'a; pi -p nope'")).toBe("codex");
  expect(runnerOf("echo \"bash -c 'codex exec go'\"")).toBeUndefined();
  expect(runnerOf("bash -o pipefail -c 'pi -p go'")).toBeUndefined();
});

test("a runner's tee at the end of its pipeline is its watch file", () => {
  expect(watchPathOf("pi -p 'list mods' 2>&1 | tee /t/pi.log")).toBe(
    "/t/pi.log",
  );
  expect(watchPathOf("codex exec go | tee -a '/t/c x.log'")).toBe("/t/c x.log");
  expect(watchPathOf("ls | tee /t/ls.txt")).toBeUndefined();
  expect(
    watchPathOf(
      "node w.ts --silence 600 -- bash -c 'pi -p go 2>&1 | tee /t/w.log'",
    ),
  ).toBe("/t/w.log");
  expect(watchPathOf("pi -p x | tee /t/watch 2> /t/err")).toBe("/t/watch");
  expect(watchPathOf("pi -p x > /t/own | cat | tee /t/out")).toBe("/t/own");
  expect(
    [
      "codex exec 'explain | tee /audit/not-a-file'",
      "pi -p 'explain > /audit/not-a-file'",
      "pi -p x | tee /t/one /t/two",
      "pi -p x > /t/one | tee /t/two",
      "pi -p x | tee /t/one | tee /t/two",
      "pi -p x | tee rel.log",
      "pi -p x | cat > /t/other | tee /t/out",
      "pi -p x | tee /t/watch < /t/unrelated",
      "pi -p x | tee /t/watch 0<&3",
      "pi -p x | tee /t/watch 0<&-",
      "pi -p x | tee /t/watch <<< 'unrelated'",
      "pi -p x | tee /t/watch <<'END'\nunrelated\nEND\n",
    ].map((command) => watchPathOf(command)),
  ).toEqual(Array.from({ length: 12 }));
});

test("a runner's prompt gives its first words", () => {
  expect(
    promptWordsOf(
      'pi -p "List mods in this repo and say which ones lack tests" 2>&1 | tee /t/p.log',
    ),
  ).toBe("List mods in this repo and…");
  expect(promptWordsOf("devin -p 'fix it'")).toBe("fix it");
  expect(promptWordsOf("codex exec 'review the diff'")).toBe("review the diff");
  expect(promptWordsOf("codex exec review")).toBe("review");
  expect(promptWordsOf("ls -la")).toBeUndefined();
  expect(promptWordsOf("codex exec 'explain | tee /audit/not-a-file'")).toBe(
    "explain | tee /audit/not-a-file",
  );
  expect(promptWordsOf("echo -p wrong; pi -p 'actual prompt'")).toBe(
    "actual prompt",
  );
  expect(promptWordsOf("pi -p '$HOME'")).toBe("$HOME");
  expect(promptWordsOf('pi -p "$HOME"')).toBeUndefined();
  expect(runnerOf('pi -p "$HOME"')).toBe("pi");
  expect(promptWordsOf("echo \"pi -p 'fix it'\"")).toBeUndefined();
  expect(promptWordsOf("printf '%s' 'exec pretend'")).toBeUndefined();
});
