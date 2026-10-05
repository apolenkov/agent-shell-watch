import { expect, test } from "claude-code/testing";

import { ownerOf } from "../../hooks/model/format.ts";
import {
  agentTableOf,
  groupLabelOf,
  groupsOf,
  isFolded,
} from "../../hooks/model/groups.ts";
import type { ShellAgentInfo } from "../../types";
import { callOf } from "../fixtures/call-of.ts";

const MIN = 60_000;
const AGENTS: Readonly<Record<string, ShellAgentInfo>> = {
  a1: {
    type: "general-purpose",
    description: "Review spec",
    status: "running",
  },
  a2: { type: "Explore", description: "Find calls", status: "completed" },
  a3: {
    type: "pi-runner",
    description: "Probe",
    status: "running",
    parentId: "a1",
  },
  a4: { type: "Plan", description: "Broke", status: "failed" },
};

test("calls group by agent; main for the main loop", () => {
  const groups = groupsOf(
    [
      callOf({ id: "m1" }),
      callOf({ id: "s1", agentId: "a1", status: "done" }),
      callOf({ id: "m2", status: "done" }),
    ],
    AGENTS,
    0,
  );
  expect(
    groups.map((group) => [group.key, group.calls.map((c) => c.id)]),
  ).toEqual([
    ["main", ["m1", "m2"]],
    ["a1", ["s1"]],
  ]);
});

test("labels: main, type and description, a fallback, a nested agent's parent", () => {
  expect(groupLabelOf("main", AGENTS)).toBe("main");
  expect(groupLabelOf("a1", AGENTS)).toBe("general-purpose: Review spec");
  expect(groupLabelOf("zz", AGENTS)).toBe("agent zz");
  expect(groupLabelOf("a3", AGENTS)).toBe(
    "pi-runner: Probe ↳ general-purpose: Review spec",
  );
  expect(ownerOf("main", AGENTS)).toBe("main");
  expect(ownerOf("a1", AGENTS)).toBe("general-purpose");
  expect(ownerOf("zz", AGENTS)).toBe("agent zz");
});

test("rollup: a live call's worst status first", () => {
  const [group] = groupsOf(
    [
      callOf({ id: "r" }),
      callOf({ id: "h", status: "hung" }),
      callOf({ id: "f", status: "failed", endedAt: 0 }),
    ],
    AGENTS,
    0,
  );
  expect(group).toMatchObject({ status: "hung", live: 2 });
});

test("rollup: a recent failure, then the agent's own status", () => {
  const failed = [callOf({ agentId: "a1", status: "failed", endedAt: 0 })];
  expect(groupsOf(failed, AGENTS, MIN)[0]?.status).toBe("failed");
  expect(groupsOf(failed, AGENTS, 3 * MIN)[0]?.status).toBe("idle");
  expect(
    groupsOf(
      [callOf({ agentId: "a4", status: "done", endedAt: 0 })],
      AGENTS,
      0,
    )[0]?.status,
  ).toBe("failed");
  expect(
    groupsOf(
      [callOf({ agentId: "a2", status: "done", endedAt: 0 })],
      AGENTS,
      0,
    )[0]?.status,
  ).toBe("done");
  expect(
    groupsOf(
      [
        callOf({ id: "d", agentId: "zz", status: "denied", endedAt: 0 }),
        callOf({ id: "s", agentId: "zz", status: "stopped", endedAt: 0 }),
      ],
      AGENTS,
      0,
    )[0]?.status,
  ).toBe("stopped");
});

test("groups go most urgent first, then the newest", () => {
  const groups = groupsOf(
    [
      callOf({ id: "m", status: "done", startedAt: 9, endedAt: 9 }),
      callOf({
        id: "x",
        agentId: "a2",
        status: "done",
        startedAt: 5,
        endedAt: 5,
      }),
      callOf({ id: "h", agentId: "zz", status: "hung" }),
      callOf({ id: "f", agentId: "a1", status: "failed", endedAt: 0 }),
    ],
    AGENTS,
    0,
  );
  expect(groups.map((group) => group.key)).toEqual(["zz", "a1", "main", "a2"]);
});

test("a group is folded by default unless live, failed or idle; choices win", () => {
  const groups = groupsOf(
    [
      callOf({ id: "m", agentId: "zz", status: "done", endedAt: 0 }),
      callOf({ id: "s", agentId: "a1" }),
    ],
    AGENTS,
    0,
  );
  const [live, done] = groups;
  expect(live && isFolded(live, {})).toBe(false);
  expect(done && isFolded(done, {})).toBe(true);
  expect(done && isFolded(done, { zz: false })).toBe(false);
  expect(live && isFolded(live, { a1: true })).toBe(true);
});

test("the agent list becomes the table the groups read", () => {
  expect(
    agentTableOf([
      { id: "a1", type: "Explore", description: "Find", status: "running" },
      {
        id: "a2",
        type: "pi-runner",
        description: "Probe",
        status: "completed",
        parentId: "a1",
      },
    ]),
  ).toEqual({
    a1: { type: "Explore", description: "Find", status: "running" },
    a2: {
      type: "pi-runner",
      description: "Probe",
      status: "completed",
      parentId: "a1",
    },
  });
});

test("main counts as a running agent; an unknown id has only its calls", () => {
  const oldFailure = (agentId?: string): string | undefined =>
    groupsOf(
      [
        callOf({
          ...(agentId !== undefined && { agentId }),
          status: "failed",
          endedAt: 0,
        }),
      ],
      AGENTS,
      3 * MIN,
    )[0]?.status;
  expect(oldFailure()).toBe("idle");
  expect(oldFailure("zz")).toBe("done");
  const edge = [callOf({ agentId: "zz", status: "failed", endedAt: 0 })];
  expect(groupsOf(edge, AGENTS, 2 * MIN - 1)[0]?.status).toBe("failed");
  expect(groupsOf(edge, AGENTS, 2 * MIN)[0]?.status).toBe("done");
  expect(groupsOf(edge, AGENTS, 0)[0]?.label).toBe("agent zz");
});
