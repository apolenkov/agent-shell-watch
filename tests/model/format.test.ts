import { expect, test } from "claude-code/testing";

import {
  agoOf,
  clockOf,
  nameOf,
  noteOf,
  outcomeOf,
  stateOf,
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
    "◐ main · codex · Review diff 2:13 · output 4s ago · › applying patch",
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
    "✗ main · Typecheck exit 2 · +1 quiet · +2 bg · +1 running",
  );
  expect(
    statusLineOf(
      [callOf({ status: "hung", runner: "pi", label: "Fix", lastOutputAt: 0 })],
      12 * MIN,
    ),
  ).toBe("⚠ hung 12m main · pi · Fix");
  expect(
    statusLineOf([callOf({ status: "quiet", lastOutputAt: 0 })], 6 * MIN),
  ).toBe("⚠ quiet 6m main · Run tests 6:00");
});

test("the rest are counted as +N; a denied call never shows", () => {
  const failed = [
    callOf({ id: "f1", status: "failed", exitCode: 1, endedAt: 50_000 }),
    callOf({ id: "f2", status: "failed", exitCode: 1, endedAt: 50_000 }),
    callOf({ id: "d", status: "denied", verdict: "denied", endedAt: 59_000 }),
  ];
  expect(statusLineOf(failed, 60_000)).toBe(
    "✗ main · Run tests exit 1 · +1 failed",
  );
  expect(statusLineOf(failed, 11 * MIN)).toBeUndefined();
  expect(
    statusLineOf(
      [callOf({ id: "h", status: "hung", lastOutputAt: 0 }), ...failed],
      60_000,
    ),
  ).toBe("⚠ hung 1m main · Run tests · +2 failed");
  expect(
    statusLineOf([callOf({ status: "denied", endedAt: 0 })], 1000),
  ).toBeUndefined();
});

test("a watched run with no output yet says so, never 'output … ago'", () => {
  const silent = callOf({ label: "Wait", outputPath: "/t/o" });
  expect(statusLineOf([silent], 45_000)).toBe(
    "◐ main · Wait 0:45 · no output · 45s",
  );
  expect(stateOf(silent, 45_000)).toBe("0:45 no output · 45s");
  expect(statusLineOf([callOf({ label: "Wait" })], 45_000)).toBe(
    "◐ main · Wait 0:45",
  );
});

test("line 1 leads with time and state, the label comes after", () => {
  expect(
    stateOf(callOf({ status: "done", endedAt: 1000, exitCode: 0 }), 9e9),
  ).toBe("0:01 exit 0");
  expect(stateOf(callOf({ lastOutputAt: 50_000 }), 51_000)).toBe(
    "0:51 output 1s ago",
  );
  expect(
    stateOf(
      callOf({ status: "quiet", outputPath: "/t/o", lastOutputAt: 0 }),
      360_000,
    ),
  ).toBe("6:00 quiet · output 6m ago");
  expect(
    stateOf(callOf({ status: "denied", verdict: "denied", endedAt: 0 }), 9),
  ).toBe("0:00 denied");
  expect(stateOf(callOf({ status: "stopped", endedAt: 3000 }), 9e9)).toBe(
    "0:03 stopped",
  );
});

test("each row's note: last output, a failure's last error, a denial's reason", () => {
  expect(noteOf(callOf({ status: "done", tail: ["README.md", ""] }))).toEqual({
    tone: "output",
    text: "README.md",
  });
  expect(
    noteOf(
      callOf({
        status: "failed",
        tail: ["x"],
        stderr: ["Exit code 2", "src/a.ts(3,1): error TS2322", ""],
      }),
    ),
  ).toEqual({ tone: "error", text: "src/a.ts(3,1): error TS2322" });
  expect(noteOf(callOf({ status: "failed", tail: ["last words"] }))).toEqual({
    tone: "error",
    text: "last words",
  });
  expect(
    noteOf(callOf({ status: "denied", stderr: ["Permission denied by rule"] })),
  ).toEqual({ tone: "denied", text: "Permission denied by rule" });
  expect(noteOf(callOf())).toBeUndefined();
});

test("no match is neutral: never on the status line, dim in the pane", () => {
  expect(
    statusLineOf(
      [
        callOf({
          status: "nomatch",
          exitCode: 1,
          verdict: "no match",
          endedAt: 0,
        }),
      ],
      1000,
    ),
  ).toBeUndefined();
  expect(
    stateOf(
      callOf({ status: "nomatch", verdict: "no match", endedAt: 2000 }),
      9e9,
    ),
  ).toBe("0:02 no match");
});

test("an unknown start time reads as —, not 0:00", () => {
  expect(
    stateOf(
      callOf({ status: "done", exitCode: 0, endedAt: 5, isTimeUnknown: true }),
      9,
    ),
  ).toBe("— exit 0");
  expect(
    statusLineOf([callOf({ label: "Wait", isTimeUnknown: true })], 5000),
  ).toBe("◐ main · Wait —");
});

test("the status line says whose the leading call is", () => {
  const agents = {
    a1: { type: "general-purpose", description: "Review", status: "running" },
  };
  const calls = [
    callOf({ id: "h", label: "Wait", status: "hung", lastOutputAt: 0 }),
    callOf({
      id: "f",
      agentId: "a1",
      runner: "devin",
      label: "Review",
      status: "failed",
      verdict: "RATE_LIMIT 1790000000",
      endedAt: 9 * 3_600_000,
    }),
  ];
  expect(statusLineOf(calls, 9 * 3_600_000, agents)).toBe(
    "⚠ hung 9h main · Wait · +1 failed",
  );
  const [, failed] = calls;
  expect(
    statusLineOf(failed === undefined ? [] : [failed], 9 * 3_600_000, agents),
  ).toBe("✗ general-purpose · devin · Review RATE_LIMIT 1790000000");
  expect(statusLineOf([callOf({ agentId: "zz", label: "Go" })], 1000, {})).toBe(
    "◐ agent zz · Go 0:01",
  );
});
