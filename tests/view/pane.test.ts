import { expect, mock, test } from "claude-code/testing";

import { paneOf } from "../fixtures/pane-of.ts";
import { textOf } from "../fixtures/text-of.ts";
import { world } from "../fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const SURFACES = ["terminal", "desktop"] as const;
const BG_TEXT =
  "Command running in background with ID: b1. Output is being written to: /t/b1.output. You will be notified.";

for (const surface of SURFACES) {
  test(`${surface}: rows, filter, expand and stop`, async ($, on) => {
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
    expect(all).toContain("List  exit 0");
    expect(all).toContain("codex · Codex review");
    expect(all).toContain("main · ls");

    await pane.press({ key: "filter" });
    const bgOnly = await textOf(pane);
    expect(bgOnly).not.toContain("List");
    expect(bgOnly).toContain("bg · main · codex exec review");

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
  const closed = await $.command.run({
    command: "shell-flow",
    args: "stop",
    origin,
    presentation,
  });
  expect(closed).toMatchObject({ text: "shell-flow closed" });
});
