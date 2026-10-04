import { expect, test } from "claude-code/testing";

import {
  fit,
  oneLine,
  paneOrder,
  rowsOf,
  visibleOf,
} from "../../hooks/model/layout.ts";
import { callOf } from "../fixtures/call-of.ts";

test("text is one line, cut to the width with an ellipsis", () => {
  expect(oneLine("python3 - <<'EOF'\n  def ed(p):\r\n\tpass\nEOF")).toBe(
    "python3 - <<'EOF' def ed(p): pass EOF",
  );
  expect(fit("abcdef", 4)).toBe("abc…");
  expect(fit("abc", 4)).toBe("abc");
  expect(fit("abc", 0)).toBe("");
});

test("live first, then failures, then finished, denied last; newest first", () => {
  const calls = [
    callOf({ id: "done-old", status: "done", startedAt: 1 }),
    callOf({ id: "run-old", startedAt: 2 }),
    callOf({ id: "denied", status: "denied", startedAt: 9 }),
    callOf({ id: "fail", status: "failed", startedAt: 3 }),
    callOf({ id: "done-new", status: "stopped", startedAt: 8 }),
    callOf({ id: "run-new", startedAt: 7 }),
    callOf({ id: "hung", status: "hung", startedAt: 0 }),
    callOf({ id: "quiet", status: "quiet", startedAt: 4 }),
  ];
  expect(paneOrder(calls).map((call) => call.id)).toEqual([
    "hung",
    "quiet",
    "run-new",
    "run-old",
    "fail",
    "done-new",
    "done-old",
    "denied",
  ]);
});

test("a row takes its lines: head, source, a note, the expansion", () => {
  expect(rowsOf(callOf(), "")).toBe(2);
  expect(rowsOf(callOf({ tail: ["x"] }), "")).toBe(3);
  expect(rowsOf(callOf({ id: "t1", tail: ["x"] }), "t1")).toBeGreaterThan(3);
});

test("what does not fit drops the oldest finished rows, never a live one", () => {
  const ordered = paneOrder([
    callOf({ id: "run", startedAt: 5 }),
    callOf({ id: "a", status: "done", startedAt: 4 }),
    callOf({ id: "b", status: "done", startedAt: 3 }),
    callOf({ id: "c", status: "done", startedAt: 2 }),
  ]);
  const cut = visibleOf(ordered, "", 6);
  expect(cut.shown.map((call) => call.id)).toEqual(["run", "a"]);
  expect(cut.hidden).toBe(2);
  expect(visibleOf(ordered, "", 100).hidden).toBe(0);
  expect(visibleOf(ordered, "", 1).shown.map((call) => call.id)).toEqual([
    "run",
  ]);
});
