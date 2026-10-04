import { expect, mock, test } from "claude-code/testing";

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
  await clock.advance(1000);
  const before = seen.statuses.length;
  await clock.advance(3000);
  expect(seen.statuses.slice(before)).toEqual([
    "✗ Typecheck exit 2",
    "✗ Typecheck exit 2",
    "✗ Typecheck exit 2",
  ]);
});
