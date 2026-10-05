import { expect, mock, test } from "claude-code/testing";

import { advance } from "../fixtures/advance.ts";
import { paneOf } from "../fixtures/pane-of.ts";
import { world } from "../fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const SURFACES = ["terminal", "desktop"] as const;
const HEREDOC =
  "python3 - <<'EOF'\nimport re\ndef ed(p, pairs):\n    s = open(p).read()\nEOF";
const COMMIT =
  'git commit -m "feat: backfill\n\nsession.start (a load, a reload, an update) and opening the pane rebuild Bash calls"';
const BG_TEXT =
  "Command running in background with ID: b1. Output is being written to: /t/b1.output. You will be notified.";

const answer = (
  _$: unknown,
  e: { command: string; run_in_background?: boolean },
): { result: Record<string, unknown>; text: string } =>
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
        result: {
          stdout: `line one\n${"y".repeat(150)}\nlast\nline\n`,
          stderr: "",
          interrupted: false,
        },
        text: "",
      };

for (const surface of SURFACES) {
  for (const columns of [40, 120]) {
    test(`${surface} at ${String(columns)} columns: every line is one line within the width`, async ($, on) => {
      const clock = mock.clock(on);
      world(on);
      on("tool.call", { tool: "Bash" }, answer);
      await $.session.start(START);
      await $.tool.call({
        tool: "Bash",
        command: HEREDOC,
        description: "Rewrite the parser with a long description that runs on",
      });
      await advance(clock, 1000);
      await $.tool.call({ tool: "Bash", command: COMMIT });
      await advance(clock, 1000);
      await $.tool.call({
        tool: "Bash",
        command: "sleep 60",
        description: "Wait",
        run_in_background: true,
      });
      const pane = await paneOf($, surface, { columns, rows: 40 });
      const texts = await pane.findAll({ type: "Text" });
      for (const text of texts) {
        expect(text.text).not.toMatch(/[\n\r\t]/u);
        expect(text.text.length).toBeLessThanOrEqual(columns);
      }
      const buttons = await pane.findAll({ type: "Button" });
      const rows = buttons.filter(
        (button) => button.key?.startsWith("row:") === true,
      );
      expect(rows[0]?.props["hotkey"]).toBe("2");
      expect(texts.some((t) => t.text.startsWith("Wa"))).toBe(true);
      if (columns === 40) {
        expect(
          texts.some(
            (t) =>
              t.text.startsWith("Rewrite the parser") && t.text.endsWith("…"),
          ),
        ).toBe(true);
      }
      await pane.press({ key: rows.at(-1)?.key ?? "" });
      const expanded = await pane.findAll({ type: "Text" });
      expect(expanded.some((t) => t.text.includes("def ed(p, pairs):"))).toBe(
        true,
      );
    });
  }

  test(`${surface}: newest and live first; what does not fit becomes +N older`, async ($, on) => {
    const clock = mock.clock(on);
    world(on);
    on("tool.call", { tool: "Bash" }, answer);
    await $.session.start(START);
    for (const n of [1, 2, 3, 4, 5]) {
      await $.tool.call({
        tool: "Bash",
        command: `echo ${String(n)}`,
        description: `Old ${String(n)}`,
      });
      await advance(clock, 1000);
    }
    await $.tool.call({
      tool: "Bash",
      command: "sleep 60",
      description: "Wait",
      run_in_background: true,
    });
    const pane = await paneOf($, surface, { columns: 80, rows: 7 });
    const found = await pane.findAll({ type: "Text" });
    const texts = found.map((t) => t.text);
    expect(texts.indexOf("Wait")).toBeLessThan(texts.indexOf("Old 5"));
    expect(texts.indexOf("Old 5")).toBeLessThan(texts.indexOf("Old 4"));
    expect(texts).not.toContain("Old 1");
    expect(texts.some((text) => /^\+\d+ older$/u.test(text))).toBe(true);
  });
}

for (const surface of SURFACES) {
  test(`${surface}: one row of room still shows the live and the failed row`, async ($, on) => {
    mock.clock(on);
    world(on);
    on("tool.call", { tool: "Bash" }, (_$, e) =>
      e.command === "tsc"
        ? { isError: true, result: "Exit code 2", text: "Exit code 2\nboom" }
        : answer(_$, e),
    );
    await $.session.start(START);
    await $.tool.call({ tool: "Bash", command: "ls", description: "List" });
    await $.tool.call({
      tool: "Bash",
      command: "tsc",
      description: "Typecheck",
    });
    await $.tool.call({
      tool: "Bash",
      command: "sleep 60",
      description: "Wait",
      run_in_background: true,
    });
    const pane = await paneOf($, surface, { columns: 80, rows: 3 });
    const found = await pane.findAll({ type: "Text" });
    const texts = found.map((t) => t.text);
    expect(texts).toContain("Wait");
    expect(texts).toContain("Typecheck");
    expect(texts.some((text) => text.includes("sleep 60"))).toBe(false);
    expect(texts).toContain("+1 older");
  });

  test(`${surface}: an expanded row short of room keeps its newest lines`, async ($, on) => {
    mock.clock(on);
    world(on);
    const steps = Array.from(
      { length: 30 },
      (_, index) => `step ${String(index + 1)}`,
    );
    on("tool.call", { tool: "Bash" }, () => ({
      result: {
        stdout: `${steps.join("\n")}\n`,
        stderr: "",
        interrupted: false,
      },
      text: "",
    }));
    await $.session.start(START);
    await $.tool.call({ tool: "Bash", command: "count", description: "Count" });
    const pane = await paneOf($, surface, { columns: 80, rows: 12 });
    const buttons = await pane.findAll({ type: "Button" });
    const row = buttons.find(
      (button) => button.key?.startsWith("row:") === true,
    );
    await pane.press({ key: row?.key ?? "" });
    const found = await pane.findAll({ type: "Text" });
    const texts = found.map((t) => t.text.trim());
    expect(texts).toContain("step 30");
    expect(texts).not.toContain("step 1");
    expect(texts.some((text) => /^… \d+ earlier lines$/u.test(text))).toBe(
      true,
    );
  });
}
