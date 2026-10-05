import { expect, test } from "claude-code/testing";

import { runnersOf } from "../../hooks/model/runners.ts";
import { callOf } from "../fixtures/call-of.ts";

const AGENTS = {
  a1: { type: "general-purpose", description: "Review", status: "running" },
  a2: {
    type: "pi-runner",
    description: "Probe",
    status: "running",
    parentId: "a1",
  },
} as const;

test("only the calls with a runner, flat; the rest is left out", () => {
  const runners = runnersOf(
    [
      callOf({ id: "ls" }),
      callOf({ id: "x1", runner: "codex" }),
      callOf({ id: "x2", runner: "pi", agentId: "a1" }),
    ],
    AGENTS,
  );
  expect(runners.map((one) => one.call.id)).toEqual(["x1", "x2"]);
});

test("by is the agent's group label: main, an agent, a nested agent", () => {
  const runners = runnersOf(
    [
      callOf({ id: "m", runner: "codex", startedAt: 3 }),
      callOf({ id: "s", runner: "devin", agentId: "a1", startedAt: 2 }),
      callOf({ id: "n", runner: "pi", agentId: "a2", startedAt: 1 }),
    ],
    AGENTS,
  );
  expect(runners.map((one) => [one.call.id, one.by])).toEqual([
    ["m", "main"],
    ["s", "general-purpose: Review"],
    ["n", "pi-runner: Probe ↳ general-purpose: Review"],
  ]);
});

test("an agent the table does not know reads agent <id>", () => {
  const [one] = runnersOf([callOf({ runner: "devin", agentId: "zz" })], AGENTS);
  expect(one?.by).toBe("agent zz");
});

test("urgency order: hung, failed, running, then settled; newest first", () => {
  const runners = runnersOf(
    [
      callOf({ id: "done", runner: "pi", status: "done", startedAt: 9 }),
      callOf({ id: "run-old", runner: "pi", startedAt: 1 }),
      callOf({ id: "fail", runner: "codex", status: "failed", startedAt: 2 }),
      callOf({ id: "run-new", runner: "devin", startedAt: 5 }),
      callOf({ id: "hung", runner: "pi", status: "hung", startedAt: 0 }),
    ],
    AGENTS,
  );
  expect(runners.map((one) => one.call.id)).toEqual([
    "hung",
    "fail",
    "run-new",
    "run-old",
    "done",
  ]);
});

test("no runners, no list", () => {
  expect(runnersOf([callOf()], AGENTS)).toEqual([]);
  expect(runnersOf([], AGENTS)).toEqual([]);
});
