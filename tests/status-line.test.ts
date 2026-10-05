import { expect, mock, test } from "claude-code/testing";

import { advance } from "./fixtures/advance.ts";
import { world } from "./fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;

test("the status line is set again on every tick, even when unchanged", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  on("tool.call", { tool: "Bash" }, () => ({
    isError: true,
    result: "Exit code 2",
    text: "Exit code 2",
  }));
  await $.session.start(START);
  await $.tool.call({ tool: "Bash", command: "tsc", description: "Typecheck" });
  await advance(clock, 1000);
  const before = seen.statuses.length;
  await advance(clock, 3000);
  const after = seen.statuses.slice(before);
  expect(after.length).toBeGreaterThanOrEqual(3);
  expect([...new Set(after)]).toEqual(["✗ main · Typecheck exit 2"]);
});
