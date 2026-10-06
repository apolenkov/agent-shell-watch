import { expect, mock, test } from "claude-code/testing";

import { advance } from "./fixtures/advance.ts";
import { paneOf } from "./fixtures/pane-of.ts";
import { textOf } from "./fixtures/text-of.ts";
import { world } from "./fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
// Plain shell calls are watched only under scope: all (runners is the
// default); the settle-edge tests run in it.
const ALL = { options: { scope: "all" } } as const;
const BG_TEXT =
  "Command running in background with ID: b1. Output is being written to: /t/b1.output. You will be notified.";
const BG_RESULT = {
  result: {
    stdout: "",
    stderr: "",
    interrupted: false,
    backgroundTaskId: "b1",
  },
  text: BG_TEXT,
};

test("the default scope watches agent runs, an ordinary call stays silent", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  on("tool.call", { tool: "Bash" }, () => BG_RESULT);
  await $.session.start(START);
  await $.tool.call({
    tool: "Bash",
    command: "sleep 600",
    description: "Wait",
    run_in_background: true,
  });
  await $.tool.call({
    tool: "Bash",
    command: "pi -p 'fix the bug'",
    description: "Pi fix",
    run_in_background: true,
  });
  await advance(clock, 2000);
  expect(seen.statuses.at(-1)).toContain("◐ main · pi · Pi fix");
  expect(seen.statuses.at(-1)).not.toContain("Wait");
  const text = await textOf(await paneOf($, "terminal"));
  expect(text).toContain("pi · Pi fix");
  expect(text).not.toContain("Wait");
  expect(text).not.toContain("sleep 600");
});

test("a guard-watched call is an agent run even without a runner name", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  on("tool.call", { tool: "Bash" }, () => BG_RESULT);
  await $.session.start(START);
  await $.tool.call({
    tool: "Bash",
    command: "node guard.ts --watch-file /t/g.log -- ./new-agent run",
    description: "Guarded",
    run_in_background: true,
  });
  await advance(clock, 1000);
  expect(seen.statuses.at(-1)).toContain("◐ main · Guarded");
});

test(
  "a TaskStop the model makes settles its background call",
  ALL,
  async ($, on) => {
    const clock = mock.clock(on);
    const seen = world(on);
    on("tool.call", { tool: "Bash" }, () => BG_RESULT);
    await $.session.start(START);
    await $.tool.call({
      tool: "Bash",
      command: "sleep 99",
      description: "Wait",
    });
    await $.tool.call({ tool: "TaskStop", task_id: "b1" });
    await advance(clock, 1000);
    expect(seen.stops).toEqual(["b1"]);
    expect(seen.statuses.at(-1)).toBeUndefined();
  },
);

test("an interrupted call is stopped, not failed", ALL, async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  on("tool.call", { tool: "Bash" }, () => ({
    isError: true,
    result: undefined,
    text: "<error>Command was aborted before completion</error>",
  }));
  await $.session.start(START);
  await $.tool.call({ tool: "Bash", command: "sleep 9", description: "Wait" });
  await advance(clock, 1000);
  expect(seen.statuses.at(-1)).toBeUndefined();
  expect(await textOf(await paneOf($, "terminal"))).toContain("○");
});

test(
  "a refused call is denied: dim in the pane, never on the status line",
  ALL,
  async ($, on) => {
    const clock = mock.clock(on);
    const seen = world(on);
    on("tool.call", { tool: "Bash" }, (_$, e) =>
      e.command === "echo test"
        ? {
            isError: true,
            result: undefined,
            text: "Permission to use Bash has been denied.",
          }
        : BG_RESULT,
    );
    await $.session.start(START);
    await $.tool.call({
      tool: "Bash",
      command: "sleep 9",
      description: "Wait",
    });
    await $.tool.call({
      tool: "Bash",
      command: "echo test",
      description: "Echo test",
    });
    await advance(clock, 1000);
    expect(seen.statuses.at(-1)).toBe("◐ main · Wait 0:01 · no output · 1s");
    expect(await textOf(await paneOf($, "terminal"))).toContain(
      "0:00 denied\nEcho test",
    );
  },
);
