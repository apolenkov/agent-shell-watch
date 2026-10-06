import { expect, mock, test } from "claude-code/testing";

import { paneOf } from "../fixtures/pane-of.ts";
import { textOf } from "../fixtures/text-of.ts";
import { world } from "../fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const SURFACES = ["terminal", "desktop"] as const;
const BG_TEXT =
  "Command running in background with ID: b1. Output is being written to: /t/b1.output. You will be notified.";

for (const surface of SURFACES) {
  test(
    `${surface}: rows, expand and stop; no filter`,
    { options: { scope: "all" } },
    async ($, on) => {
      mock.clock(on);
      const seen = world(on);
      seen.tails.set("/t/b1.output", "step 1\nstep 2\n");
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
      await $.tool.call({ tool: "Bash", command: "ls", description: "List" });
      await $.tool.call({
        tool: "Bash",
        command: "codex exec review",
        description: "Codex review",
        run_in_background: true,
      });

      const pane = await paneOf($, surface);
      const all = await textOf(pane);
      expect(all).toContain("0:00 exit 0");
      expect(all).toContain("List");
      expect(all).toContain("codex · Codex review");
      expect(all).toContain("ls");

      expect(all).toContain("bg · codex exec review");
      expect(await pane.find({ key: "filter" })).toBeUndefined();
      expect(all).not.toContain("background only");

      const rows = await pane.findAll({ type: "Button" });
      const row = rows.find(
        (button) => button.key?.startsWith("row:") === true,
      );
      await pane.press({ key: row?.key ?? "" });
      const expanded = await textOf(pane);
      expect(expanded).toContain("$ codex exec review");
      expect(expanded).toContain("step 2");
      expect(expanded).toContain("output: /t/b1.output");

      const stop = rows.find(
        (button) => button.key?.startsWith("stop:") === true,
      );
      await pane.press({ key: stop?.key ?? "" });
      expect(seen.stops).toEqual(["b1"]);
      expect(
        await pane.find({ type: "Button", key: stop?.key ?? "" }),
      ).toBeUndefined();
    },
  );
}

test("an empty pane says so; /shell-watch opens it and stop closes it", async ($, on) => {
  mock.clock(on);
  const seen = world(on);
  await $.session.start(START);
  expect(await textOf(await paneOf($, "terminal"))).toContain(
    "No Bash calls yet.",
  );
  const presentation = { isFullscreen: true, columns: 160 };
  const origin = { kind: "composer" } as const;
  await $.command.run({
    command: "shell-watch",
    args: "",
    origin,
    presentation,
  });
  expect(seen.opened).toEqual(["shell-watch"]);
  const again = await $.command.run({
    command: "shell-watch",
    args: "",
    origin,
    presentation,
  });
  expect(again).toMatchObject({
    text: "keys on the pane · Esc → prompt · /shell-watch again refocuses",
  });
  expect(seen.opened).toEqual(["shell-watch", "shell-watch"]);
  expect(seen.focused).toEqual([true, true]);
  const closed = await $.command.run({
    command: "shell-watch",
    args: "stop",
    origin,
    presentation,
  });
  expect(closed).toMatchObject({ text: "closed" });
});

for (const surface of SURFACES) {
  test(
    `${surface}: each row has a focusable toggle that expands it`,
    { options: { scope: "all" } },
    async ($, on) => {
      mock.clock(on);
      world(on);
      on("tool.call", { tool: "Bash" }, () => ({
        result: { stdout: "ok\n", stderr: "", interrupted: false },
        text: "ok",
      }));
      await $.session.start(START);
      await $.tool.call({
        tool: "Bash",
        command: "ls -la",
        description: "List",
      });
      const pane = await paneOf($, surface);
      const buttons = await pane.findAll({ type: "Button" });
      const toggle = buttons.find(
        (button) => button.key?.startsWith("row:") === true,
      );
      expect(toggle?.text).toBe("2 ▸");
      expect(toggle?.props["plain"]).toBeUndefined();
      await pane.press({ key: toggle?.key ?? "" });
      const expanded = await pane.find({ key: toggle?.key ?? "" });
      expect(expanded?.text).toBe("2 ▾");
      expect(await textOf(pane)).toContain("$ ls -la");
    },
  );
}
