import { expect, test } from "claude-code/testing";

import { pickSession } from "../../hooks/model/usage.ts";

const START = Date.UTC(2026, 9, 5, 14, 32, 9, 661);
const SECOND = 1000;
const WINDOW = { from: START - 2 * SECOND, to: START + 60 * SECOND };

test("pickSession: exactly one file in the window is the session", () => {
  const files = [
    { path: "/a", at: START - 3 * SECOND, size: 1 },
    { path: "/b", at: START - SECOND, size: 1 },
    { path: "/c", at: START + 61 * SECOND, size: 1 },
  ];
  expect(pickSession(files, WINDOW)?.path).toBe("/b");
});

// ponytail: Pi's parallel runners started in one second cannot be told apart.
test("pickSession: two files in the window, or none, are no answer", () => {
  const two = [
    { path: "/a", at: START, size: 1 },
    { path: "/b", at: START + SECOND, size: 1 },
  ];
  expect(pickSession(two, WINDOW)).toBeUndefined();
  expect(pickSession([], WINDOW)).toBeUndefined();
});

test("pickSession near: the nearest start wins, the earlier on a tie", () => {
  const two = [
    { path: "/far", at: START + 5 * SECOND, size: 1 },
    { path: "/near", at: START + SECOND, size: 1 },
  ];
  expect(pickSession(two, WINDOW, START)?.path).toBe("/near");
  const tie = [
    { path: "/late", at: START + SECOND, size: 1 },
    { path: "/early", at: START - SECOND, size: 1 },
  ];
  expect(pickSession(tie, WINDOW, START)?.path).toBe("/early");
});

test("pickSession near: one candidate is taken, none is no answer", () => {
  const one = [{ path: "/a", at: START + SECOND, size: 1 }];
  expect(pickSession(one, WINDOW, START)?.path).toBe("/a");
  expect(pickSession([], WINDOW, START)).toBeUndefined();
});
