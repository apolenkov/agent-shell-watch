import type { On } from "claude-code";
import { type Engine, expect, mock, test } from "claude-code/testing";

import { paneOf } from "../fixtures/pane-of.ts";
import { textOf } from "../fixtures/text-of.ts";
import { world } from "../fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const RUN = {
  command: "shell-watch",
  args: "",
  origin: { kind: "composer" },
  presentation: { isFullscreen: false, columns: 120 },
} as const;
const BG_TEXT =
  "Command running in background with ID: b1. Output is being written to: /t/b1.output. You will be notified.";

const withRunner = async (
  $: Engine,
  on: On,
): Promise<ReturnType<typeof world>> => {
  const clock = mock.clock(on);
  const seen = world(on);
  on("tool.call", { tool: "Bash" }, (_$, e) =>
    e.run_in_background === true
      ? {
          result: {
            stdout: "",
            stderr: "",
            interrupted: false,
            backgroundTaskId: "b1",
          },
          text: BG_TEXT,
        }
      : {
          result: { stdout: "ok\n", stderr: "", interrupted: false },
          text: "ok",
        },
  );
  await $.session.start(START);
  for (const n of [1, 2, 3]) {
    await $.tool.call({
      tool: "Bash",
      command: `echo ${String(n)}`,
      description: `Old ${String(n)}`,
    });
  }
  await $.tool.call({
    tool: "Bash",
    command: "codex exec review",
    description: "Review diff",
    run_in_background: true,
  });
  seen.files.set("/t/b1.output", { size: 30, mtimeMs: 0 });
  seen.tails.set("/t/b1.output", "reading\nreviewing src/queue.ts\n");
  await clock.advance(2000);
  await clock.settle();
  return seen;
};

for (const surface of ["terminal", "desktop"] as const) {
  test(
    `${surface}: inline and short, the runner row keeps its last line`,
    { options: { scope: "all" } },
    async ($, on) => {
      await withRunner($, on);
      const pane = await paneOf($, surface, { columns: 100, rows: 5 });
      const text = await textOf(pane);
      expect(text).toContain("› reviewing src/queue.ts");
      expect(text).not.toContain("echo 1");
    },
  );

  test(
    `${surface}: inline and tall enough, every row is drawn in full`,
    { options: { scope: "all" } },
    async ($, on) => {
      await withRunner($, on);
      const pane = await paneOf($, surface, { columns: 100, rows: 30 });
      const text = await textOf(pane);
      expect(text).toContain("› reviewing src/queue.ts");
      expect(text).toContain("echo 1");
      expect(text).not.toContain("older");
    },
  );
}

test(
  "/shell-watch asks for the height its rows need",
  { options: { scope: "all" } },
  async ($, on) => {
    const seen = await withRunner($, on);
    await $.command.run(RUN);
    // toolbar and hint 2 + main's header 1 + runner 3 (head, source, note) +
    // three done rows, each head, source and its output line 3
    expect(seen.rows).toEqual([15]);
  },
);
