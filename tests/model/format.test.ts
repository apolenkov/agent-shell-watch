import { expect, test } from "claude-code/testing";

import {
  agoOf,
  clockOf,
  nameOf,
  outcomeOf,
  statusLineOf,
} from "../../hooks/model/format.ts";
import { callOf } from "../fixtures/call-of.ts";

const MIN = 60_000;

test("elapsed reads as a clock, freshness as an age", () => {
  expect(clockOf(133_000)).toBe("2:13");
  expect(clockOf(3_723_000)).toBe("1:02:03");
  expect(agoOf(4000)).toBe("4s");
  expect(agoOf(6 * MIN)).toBe("6m");
  expect(agoOf(125 * MIN)).toBe("2h");
});

test("a runner's name leads its label; outcome is verdict, else exit code", () => {
  expect(nameOf(callOf({ runner: "codex", label: "Review" }))).toBe(
    "codex · Review",
  );
  expect(nameOf(callOf())).toBe("Run tests");
  expect(outcomeOf(callOf({ verdict: "DONE 0", exitCode: 0 }))).toBe("DONE 0");
  expect(outcomeOf(callOf({ exitCode: 2 }))).toBe("exit 2");
  expect(outcomeOf(callOf())).toBe("");
});

test("nothing running and nothing recently failed: no status line", () => {
  expect(statusLineOf([], 0)).toBeUndefined();
  expect(
    statusLineOf([callOf({ status: "done", endedAt: 0 })], MIN),
  ).toBeUndefined();
  expect(
    statusLineOf([callOf({ status: "failed", endedAt: 0 })], 3 * MIN),
  ).toBeUndefined();
});

test("a running runner shows elapsed, freshness and what it says now", () => {
  const codex = callOf({
    label: "Review diff",
    runner: "codex",
    lastOutputAt: 129_000,
    tail: ["reading files", "applying patch", ""],
  });
  expect(statusLineOf([codex], 133_000)).toBe(
    "shell: ◐ codex · Review diff 2:13 · output 4s ago · › applying patch",
  );
});

test("the most urgent leads; the rest are counted", () => {
  const calls = [
    callOf({ id: "a", label: "Run e2e tests" }),
    callOf({ id: "b", background: true }),
    callOf({ id: "c", background: true }),
    callOf({ id: "d", status: "quiet", lastOutputAt: 0 }),
    callOf({
      id: "e",
      label: "Typecheck",
      status: "failed",
      exitCode: 2,
      endedAt: 6 * MIN,
    }),
  ];
  expect(statusLineOf(calls, 7 * MIN)).toBe(
    "shell: ✗ Typecheck exit 2 · ⚠ 1 quiet · +2 bg · +1 running",
  );
  expect(
    statusLineOf(
      [callOf({ status: "hung", runner: "pi", label: "Fix", lastOutputAt: 0 })],
      12 * MIN,
    ),
  ).toBe("shell: ⚠ hung 12m pi · Fix");
  expect(
    statusLineOf([callOf({ status: "quiet", lastOutputAt: 0 })], 6 * MIN),
  ).toBe("shell: ⚠ quiet 6m Run tests 6:00");
});
