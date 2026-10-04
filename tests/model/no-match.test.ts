import { expect, test } from "claude-code/testing";

import { isLive, noticed, settled } from "../../hooks/model/calls.ts";
import { isNoMatchCommand } from "../../hooks/model/parse.ts";
import { callOf } from "../fixtures/call-of.ts";

test("a search or test command's exit 1 means no match", () => {
  for (const command of [
    "grep -rn foo src",
    "cat x | grep y",
    "cd /w && rg TODO",
    "git grep -n needle",
    "LC_ALL=C egrep x f",
    "diff a b",
    "test -f /tmp/x",
    "[ -d build ]",
    "[[ -n $x ]]",
    "cmp a b",
    "pgrep node",
    "ls | head -3 | ag name",
    "/usr/bin/fgrep x y",
    "ack foo; grep bar baz",
  ]) {
    expect(isNoMatchCommand(command), command).toBe(true);
  }
  for (const command of [
    "npm test",
    "grep foo x | wc -l",
    "grep foo x && npm run build",
    'echo "a | grep b"',
    "git commit -m 'grep it'",
    "tsc -p .",
    "rg foo || exit 1",
  ]) {
    expect(isNoMatchCommand(command), command).toBe(false);
  }
});

test("exit 1 of a search is no match; exit 2 of it still fails", () => {
  const grep = callOf({ command: "cat x | grep y" });
  expect(
    settled(grep, { isError: true, text: "Exit code 1" }, 9),
  ).toMatchObject({ status: "nomatch", exitCode: 1, verdict: "no match" });
  expect(
    settled(
      grep,
      { isError: true, text: "Exit code 2\ngrep: x: No such file" },
      9,
    ).status,
  ).toBe("failed");
  expect(
    settled(
      callOf({ command: "npm test" }),
      { isError: true, text: "Exit code 1" },
      9,
    ).status,
  ).toBe("failed");
  const bg = [callOf({ command: "rg foo", background: true, taskId: "b1" })];
  expect(
    noticed(bg, [{ taskId: "b1", status: "failed", exitCode: 1 }], 9)[0],
  ).toMatchObject({ status: "nomatch", verdict: "no match" });
  expect(isLive(callOf({ status: "nomatch" }))).toBe(false);
});
