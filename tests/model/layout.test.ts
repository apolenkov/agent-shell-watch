import { expect, test } from "claude-code/testing";

import {
  fit,
  oneLine,
  paneOrder,
  rowsOf,
  tailFit,
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

test("short of height: compact rows first, then the oldest finished go", () => {
  const ordered = paneOrder([
    callOf({ id: "run", startedAt: 5 }),
    callOf({ id: "fail", status: "failed", startedAt: 1, stderr: ["boom"] }),
    callOf({ id: "a", status: "done", startedAt: 4 }),
    callOf({ id: "b", status: "done", startedAt: 3 }),
    callOf({ id: "c", status: "denied", startedAt: 2 }),
  ]);
  const roomy = visibleOf(ordered, "", 100);
  expect(roomy).toMatchObject({ hidden: 0, isCompact: false });

  const compact = visibleOf(ordered, "", 6);
  expect(compact.isCompact).toBe(true);
  expect(compact.shown.map((call) => call.id)).toEqual([
    "run",
    "fail",
    "a",
    "b",
    "c",
  ]);

  const tight = visibleOf(ordered, "", 3);
  expect(tight.shown.map((call) => call.id)).toEqual(["run", "fail"]);
  expect(tight.hidden).toBe(3);

  const one = visibleOf(ordered, "", 1);
  expect(one.shown.map((call) => call.id)).toEqual(["run", "fail"]);
});

test("the selected row keeps its lines and gets the room left for details", () => {
  const ordered = paneOrder([
    callOf({ id: "run", startedAt: 5 }),
    callOf({
      id: "sel",
      status: "done",
      startedAt: 4,
      tail: Array.from(
        { length: 30 },
        (_, index) => `step ${String(index + 1)}`,
      ),
    }),
    callOf({ id: "old", status: "done", startedAt: 1 }),
  ]);
  const cut = visibleOf(ordered, "sel", 12);
  expect(cut.isCompact).toBe(true);
  expect(cut.shown.map((call) => call.id)).toEqual(["run", "sel", "old"]);
  // 12 - run 1 - old 1 - sel head, source and note 3
  expect(cut.detailRoom).toBe(7);
});

test("details keep the newest lines that fit, the rest counted on top", () => {
  const lines = ["$ run", "step 1", "step 2", "step 3", "step 4"];
  expect(tailFit(lines, 10)).toEqual(lines);
  expect(tailFit(lines, 3)).toEqual(["… 3 earlier lines", "step 3", "step 4"]);
  expect(tailFit(lines, 0)).toEqual([]);
});

test("equal start times: the later in the list is the newer", () => {
  const calls = [
    callOf({ id: "first", status: "done", startedAt: 5 }),
    callOf({ id: "second", status: "done", startedAt: 5 }),
    callOf({ id: "third", status: "done", startedAt: 5 }),
  ];
  expect(paneOrder(calls).map((call) => call.id)).toEqual([
    "third",
    "second",
    "first",
  ]);
});

test("compact, a live runner still shows its last line", () => {
  const ordered = paneOrder([
    callOf({ id: "codex", runner: "codex", tail: ["reviewing src/queue.ts"] }),
    callOf({ id: "a", status: "done", startedAt: -1 }),
    callOf({ id: "b", status: "done", startedAt: -2 }),
  ]);
  const cut = visibleOf(ordered, "", 4);
  expect(cut.isCompact).toBe(true);
  expect(cut.shown.map((call) => call.id)).toEqual(["codex", "a", "b"]);
  const tight = visibleOf(ordered, "", 3);
  expect(tight.shown.map((call) => call.id)).toEqual(["codex"]);
  expect(tight.hidden).toBe(2);
});
