import { expect, mock, test } from "claude-code/testing";

import { advance } from "../fixtures/advance.ts";
import { paneOf } from "../fixtures/pane-of.ts";
import { textOf } from "../fixtures/text-of.ts";
import { world } from "../fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const RUN = {
  command: "shell-watch",
  args: "",
  origin: { kind: "composer" },
  presentation: { isFullscreen: true, columns: 160 },
} as const;
const BG_TEXT =
  "Command running in background with ID: b1. Output is being written to: /t/b1.output. You will be notified.";

for (const surface of ["terminal", "desktop"] as const) {
  test(
    `${surface}: an open pane keeps every running row's last line fresh`,
    { options: { scope: "all" } },
    async ($, on) => {
      const clock = mock.clock(on);
      const seen = world(on);
      on("tool.call", { tool: "Bash" }, () => ({
        result: {
          stdout: "",
          stderr: "",
          interrupted: false,
          backgroundTaskId: "b1",
        },
        text: BG_TEXT,
      }));
      await $.session.start(START);
      await $.tool.call({
        tool: "Bash",
        command: "for i in 1 2 3; do echo step $i; done",
        description: "Count steps",
        run_in_background: true,
      });
      await $.command.run(RUN);
      seen.files.set("/t/b1.output", { size: 21, mtimeMs: 0 });
      seen.tails.set("/t/b1.output", "step 1\nstep 2\nstep 3\n");
      await advance(clock, 2000);
      expect(await textOf(await paneOf($, surface))).toContain("› step 3");
    },
  );
}
