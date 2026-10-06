import { expect, mock, test } from "claude-code/testing";

import { paneOf } from "../fixtures/pane-of.ts";
import { world } from "../fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const SURFACES = ["terminal", "desktop"] as const;
// Plain calls make the rows; the default runners scope would skip them.
const ALL = { options: { scope: "all" } } as const;
const BG_TEXT =
  "Command running in background with ID: b1. Output is being written to: /t/b1.output. You will be notified.";
const LONG = "x".repeat(200);

for (const surface of SURFACES) {
  test(
    `${surface}: state before label, a note per row, hotkeys and a hint`,
    ALL,
    async ($, on) => {
      mock.clock(on);
      world(on);
      on("tool.call", { tool: "Bash" }, (_$, e) => {
        if (e.command === "tsc") {
          return {
            isError: true,
            result: "Exit code 2",
            text: "Exit code 2\nsrc/a.ts(3,1): error TS2322\n",
          };
        }
        if (e.command === "echo hi") {
          return {
            isError: true,
            result: undefined,
            text: "Permission to use Bash has been denied.",
          };
        }
        if (e.run_in_background === true) {
          return {
            result: {
              stdout: "",
              stderr: "",
              interrupted: false,
              backgroundTaskId: "b1",
            },
            text: BG_TEXT,
          };
        }
        return {
          result: {
            stdout: `README.md\n${LONG}\n`,
            stderr: "",
            interrupted: false,
          },
          text: "",
        };
      });
      await $.session.start(START);
      await $.tool.call({
        tool: "Bash",
        command: "ls -1",
        description: "List files",
      });
      await $.tool.call({
        tool: "Bash",
        command: "tsc",
        description: "Typecheck",
      });
      await $.tool.call({
        tool: "Bash",
        command: "echo hi",
        description: "Greet",
      });
      await $.tool.call({
        tool: "Bash",
        command: "sleep 60",
        description: "Wait",
        run_in_background: true,
      });
      const pane = await paneOf($, surface);
      const found = await pane.findAll({ type: "Text" });
      const texts = found.map((t) => t.text);

      const state = texts.indexOf("0:00 exit 2");
      expect(state).toBeGreaterThan(-1);
      expect(texts.indexOf("Typecheck")).toBe(state + 1);

      const failure = await pane.find({
        type: "Text",
        text: "✗ src/a.ts(3,1): error TS2322",
      });
      expect(failure?.props["color"]).toBe("red");
      const reason = await pane.find({
        type: "Text",
        text: /Permission to use Bash/u,
      });
      expect(reason?.props["dimColor"]).toBe(true);
      const note = texts.find((text) => text.includes("› x"));
      expect((note ?? "").length).toBeLessThanOrEqual(80);
      expect(texts).toContain("0:00 no output · 0s");

      const buttons = await pane.findAll({ type: "Button" });
      const hotkeys = Object.fromEntries(
        buttons.map((button) => [button.key ?? "", button.props["hotkey"]]),
      );
      expect(hotkeys["clear"]).toBe("c");
      expect(hotkeys["close"]).toBe("q");
      const rows = buttons.filter(
        (button) => button.key?.startsWith("row:") === true,
      );
      expect(rows.map((row) => row.props["hotkey"])).toEqual([
        "2",
        "3",
        "4",
        "5",
      ]);
      const stop = buttons.find(
        (button) => button.key?.startsWith("stop:") === true,
      );
      expect(stop?.props["hotkey"]).toBe("s");
      expect(texts).toContain(
        "1–9 open · f fold · c clear · q close · Esc → prompt",
      );
      const labels = Object.fromEntries(
        buttons.map((button) => [button.key ?? "", button.text]),
      );
      expect(labels["clear"]).toBe("c clear");
      expect(labels["close"]).toBe("q close");
      expect(stop?.text).toBe("s stop");
      expect(rows.map((row) => row.text)).toEqual(["2 ▸", "3 ▸", "4 ▸", "5 ▸"]);
      // The first line, main's header, holds the focus.
      expect(rows.every((row) => row.props["autoFocus"] === undefined)).toBe(
        true,
      );
      const header = buttons.find((button) => button.key === "group:main");
      expect(header?.props["autoFocus"]).toBe(true);
    },
  );
}
