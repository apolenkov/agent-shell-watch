import { expect, mock, test } from "claude-code/testing";

import { paneOf } from "../fixtures/pane-of.ts";
import { textOf } from "../fixtures/text-of.ts";
import { world } from "../fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const SURFACES = ["terminal", "desktop"] as const;
const BG_TEXT =
  "Command running in background with ID: b1. Output is being written to: /t/b1.output. You will be notified.";

for (const surface of SURFACES) {
  test(`${surface}: rows, expand and stop; no filter`, async ($, on) => {
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
    expect(all).toContain("main · ls");

    expect(all).toContain("bg · main · codex exec review");
    expect(await pane.find({ key: "filter" })).toBeUndefined();
    expect(all).not.toContain("background only");

    const rows = await pane.findAll({ type: "Button" });
    const row = rows.find((button) => button.key?.startsWith("row:") === true);
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
  });
}

test("an empty pane says so; /shell-flow opens it and stop closes it", async ($, on) => {
  mock.clock(on);
  const seen = world(on);
  await $.session.start(START);
  expect(await textOf(await paneOf($, "terminal"))).toContain(
    "No Bash calls yet.",
  );
  const presentation = { isFullscreen: true, columns: 160 };
  const origin = { kind: "composer" } as const;
  await $.command.run({
    command: "shell-flow",
    args: "",
    origin,
    presentation,
  });
  expect(seen.opened).toEqual(["shell-flow"]);
  const again = await $.command.run({
    command: "shell-flow",
    args: "",
    origin,
    presentation,
  });
  expect(again).toMatchObject({
    text: "keys on the pane · Esc → prompt · /shell-flow again refocuses",
  });
  expect(seen.opened).toEqual(["shell-flow", "shell-flow"]);
  expect(seen.focused).toEqual([true, true]);
  const closed = await $.command.run({
    command: "shell-flow",
    args: "stop",
    origin,
    presentation,
  });
  expect(closed).toMatchObject({ text: "closed" });
});

for (const surface of SURFACES) {
  test(`${surface}: each row has a focusable toggle that expands it`, async ($, on) => {
    mock.clock(on);
    world(on);
    on("tool.call", { tool: "Bash" }, () => ({
      result: { stdout: "ok\n", stderr: "", interrupted: false },
      text: "ok",
    }));
    await $.session.start(START);
    await $.tool.call({ tool: "Bash", command: "ls -la", description: "List" });
    const pane = await paneOf($, surface);
    const buttons = await pane.findAll({ type: "Button" });
    const toggle = buttons.find(
      (button) => button.key?.startsWith("row:") === true,
    );
    expect(toggle?.text).toBe("1 ▸");
    expect(toggle?.props["plain"]).toBeUndefined();
    await pane.press({ key: toggle?.key ?? "" });
    const expanded = await pane.find({ key: toggle?.key ?? "" });
    expect(expanded?.text).toBe("1 ▾");
    expect(await textOf(pane)).toContain("$ ls -la");
  });
}

const LONG = "x".repeat(200);

for (const surface of SURFACES) {
  test(`${surface}: state before label, a note per row, hotkeys and a hint`, async ($, on) => {
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
      "1",
      "2",
      "3",
      "4",
    ]);
    const stop = buttons.find(
      (button) => button.key?.startsWith("stop:") === true,
    );
    expect(stop?.props["hotkey"]).toBe("s");
    expect(texts).toContain("1–9 open · c clear · q close · Esc → prompt");
    const labels = Object.fromEntries(
      buttons.map((button) => [button.key ?? "", button.text]),
    );
    expect(labels["clear"]).toBe("c clear");
    expect(labels["close"]).toBe("q close");
    expect(stop?.text).toBe("s stop");
    expect(rows.map((row) => row.text)).toEqual(["1 ▸", "2 ▸", "3 ▸", "4 ▸"]);
    expect(rows.map((row) => row.props["autoFocus"])).toEqual([
      true,
      undefined,
      undefined,
      undefined,
    ]);
  });
}
