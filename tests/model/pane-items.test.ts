import { expect, test } from "claude-code/testing";

import { type Group, groupsOf } from "../../hooks/model/groups.ts";
import { paneLayoutOf, rowsWantedOf } from "../../hooks/model/pane-items.ts";
import { callOf } from "../fixtures/call-of.ts";

const AGENTS = {
  a1: { type: "general-purpose", description: "Review", status: "running" },
  a2: { type: "Explore", description: "Old", status: "completed" },
} as const;

const owners = (): readonly Group[] =>
  groupsOf(
    [
      callOf({ id: "m1", status: "hung", outputPath: "/t/o" }),
      callOf({ id: "m2", status: "done", endedAt: 0, startedAt: -1 }),
      callOf({ id: "s1", agentId: "a1", status: "failed", endedAt: 0 }),
      callOf({ id: "x1", agentId: "a2", status: "done", endedAt: 0 }),
    ],
    AGENTS,
    0,
  );

const shapeOf = (layout: ReturnType<typeof paneLayoutOf>): readonly string[] =>
  layout.items.map((item) => {
    if (item.kind === "row") {
      return `  ${item.call.id}`;
    }
    return `${item.isFolded ? "▸" : "▾"} ${item.group.key}`;
  });

test("headers lead their calls; finished groups fold; most urgent first", () => {
  const layout = paneLayoutOf(owners(), {}, { selected: "", budget: 100 });
  expect(shapeOf(layout)).toEqual([
    "▾ main",
    "  m1",
    "  m2",
    "▾ a1",
    "  s1",
    "▸ a2",
  ]);
  expect(layout.hidden).toBe(0);
});

test("the person's folds win over the defaults", () => {
  const layout = paneLayoutOf(
    owners(),
    { main: true, a2: false },
    { selected: "", budget: 100 },
  );
  expect(shapeOf(layout)).toEqual(["▸ main", "▾ a1", "  s1", "▾ a2", "  x1"]);
});

test("short of room: every header stays, rows go compact, then +N older", () => {
  const layout = paneLayoutOf(owners(), {}, { selected: "", budget: 4 });
  expect(shapeOf(layout)).toEqual(["▾ main", "  m1", "▾ a1", "  s1", "▸ a2"]);
  expect(layout.hidden).toBe(1);
  expect(layout.isCompact).toBe(true);
});

test("a selected row in a folded group is not drawn", () => {
  const layout = paneLayoutOf(owners(), {}, { selected: "x1", budget: 100 });
  expect(shapeOf(layout)).toEqual([
    "▾ main",
    "  m1",
    "  m2",
    "▾ a1",
    "  s1",
    "▸ a2",
  ]);
});

test("the height asked for counts the headers", () => {
  // chrome 2 + headers 3 + m1, m2, s1 at two lines each (head, command)
  expect(rowsWantedOf(owners(), {})).toBe(11);
});
