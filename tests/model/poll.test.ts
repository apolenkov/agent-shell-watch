import { expect, test } from "claude-code/testing";

import {
  isRepairDue,
  isTailDue,
  liveAgentsOf,
  tailPathOf,
  watchedOf,
} from "../../hooks/model/poll.ts";
import { callOf } from "../fixtures/call-of.ts";

test("live calls with a file, and runners owing a verdict, are watched", () => {
  const calls = [
    callOf({ id: "fg" }),
    callOf({ id: "bg", outputPath: "/t/o" }),
    callOf({ id: "w", watchPath: "/t/w" }),
    callOf({ id: "old", status: "done", outputPath: "/t/o" }),
    callOf({ id: "owed", status: "done", outputPath: "/t/o", needsTail: true }),
  ];
  expect(watchedOf(calls).map((call) => call.id)).toEqual(["bg", "w", "owed"]);
});

test("the tail is read on new output when wanted, or when a verdict is owed", () => {
  const bg = callOf({ outputPath: "/t/o" });
  expect(isTailDue(bg, { isNew: true, isWanted: true })).toBe(true);
  expect(isTailDue(bg, { isNew: false, isWanted: true })).toBe(false);
  expect(isTailDue(bg, { isNew: true, isWanted: false })).toBe(false);
  expect(
    isTailDue(callOf({ outputPath: "/t/o", needsTail: true }), {
      isNew: false,
      isWanted: false,
    }),
  ).toBe(true);
  expect(isTailDue(callOf(), { isNew: true, isWanted: true })).toBe(false);
});

test("live progress is read from the watch file, the final verdict from the output", () => {
  const live = callOf({
    runner: "codex",
    watchPath: "/t/w",
    outputPath: "/t/o",
  });
  expect(tailPathOf(live)).toBe("/t/w");
  expect(tailPathOf({ ...live, status: "done", needsTail: true })).toBe("/t/o");
  const foreground = callOf({ runner: "pi", watchPath: "/t/w" });
  expect(tailPathOf(foreground)).toBe("/t/w");
  expect(isTailDue(foreground, { isNew: true, isWanted: true })).toBe(true);
  expect(tailPathOf(callOf())).toBeUndefined();
});

test("a hung call sends the poller to the transcripts, at most every 30 s", () => {
  const hung = [callOf({ status: "hung" })];
  expect(isRepairDue(hung, 40_000, 0)).toBe(true);
  expect(isRepairDue(hung, 40_000, 20_000)).toBe(false);
  expect(isRepairDue([callOf()], 40_000, 0)).toBe(false);
});

test("the agents that hold a running call are the ones to read", () => {
  const calls = [
    callOf({ id: "a", agentId: "x" }),
    callOf({ id: "b", agentId: "y", status: "done" }),
    callOf({ id: "c" }),
  ];
  expect([...liveAgentsOf(calls)]).toEqual(["x"]);
});
