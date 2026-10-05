import type { AgentInfo, On } from "claude-code";
import { type Engine, expect, mock, test } from "claude-code/testing";

import { labelOf } from "../fixtures/label-of.ts";
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
const SURFACES = ["terminal", "desktop"] as const;
const AGENTS: AgentInfo[] = [
  {
    id: "a1",
    type: "general-purpose",
    description: "Review spec",
    status: "running",
  },
];
const BG_TEXT =
  "Command running in background with ID: b1. Output is being written to: /t/b1.output. You will be notified.";

const withRunners = async (
  $: Engine,
  on: On,
): Promise<ReturnType<typeof world>> => {
  mock.clock(on);
  const seen = world(on, {}, AGENTS);
  seen.transcripts.set("a1", [
    {
      role: "assistant",
      text: "",
      toolUses: [
        {
          tool_use_id: "d1",
          tool: "Bash",
          input: {
            command: "devin -p 'review the spec'",
            description: "Review",
          },
          isError: true,
          text: "Exit code 1\nRATE_LIMIT 1790000000",
          durationMs: 3000,
        },
      ],
    },
  ]);
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
  return seen;
};

for (const surface of SURFACES) {
  test(`${surface}: r flips to the runners: flat, no headers, by on the second line`, async ($, on) => {
    const seen = await withRunners($, on);
    await $.command.run(RUN);
    const pane = await paneOf($, surface, { columns: 100, rows: 30 });
    expect(await labelOf(pane, "view")).toBe("r runners");
    expect(await pane.find({ key: "fold" })).toBeDefined();

    await pane.press({ key: "view" });
    const found = await pane.findAll({ type: "Text" });
    const texts = found.map((text) => text.text);
    expect(texts).toContain("runners · 2 · 1 live · 1 failed");
    expect(texts).toContain("by main · bg · codex exec review");
    expect(texts).toContain(
      "by general-purpose: Review spec · devin -p 'review the spec'",
    );
    expect(texts).not.toContain("List");
    expect(texts.some((text) => text.startsWith("ls"))).toBe(false);
    expect(texts).toContain(
      "1–9 open · r agents · c clear · q close · Esc → prompt",
    );
    expect(await labelOf(pane, "view")).toBe("r agents");
    expect(await pane.find({ key: "fold" })).toBeUndefined();
    const buttons = await pane.findAll({ type: "Button" });
    const keys = buttons.map((button) => button.key);
    expect(keys.some((key) => key?.startsWith("group:") === true)).toBe(false);
    const rows = buttons.filter((b) => b.key?.startsWith("row:") === true);
    expect(rows.map((row) => row.props["hotkey"])).toEqual(["1", "2"]);
    // the failed devin first, then the live codex
    expect(rows[0]?.key).toBe("row:d1");
    expect(rows[1]?.key).toMatch(/^row:toolu_/u);
    expect(seen.focused.at(-1)).toBe(true);

    await pane.press({ key: "view" });
    expect(await labelOf(pane, "view")).toBe("r runners");
    expect(await textOf(pane)).toContain("List");
  });

  test(`${surface}: a pane with no runner says so`, async ($, on) => {
    mock.clock(on);
    world(on, { view: "runners" });
    on("tool.call", { tool: "Bash" }, () => ({
      result: { stdout: "ok\n", stderr: "", interrupted: false },
      text: "ok",
    }));
    await $.session.start(START);
    await $.tool.call({ tool: "Bash", command: "ls", description: "List" });
    const text = await textOf(await paneOf($, surface));
    expect(text).toContain("No runners yet.");
    expect(text).not.toContain("No Bash calls yet.");
    expect(text).not.toContain("List");
  });
}

test("r re-opens the pane with the rows the other view needs", async ($, on) => {
  const seen = await withRunners($, on);
  await $.command.run(RUN);
  const pane = await paneOf($, "terminal");
  await pane.press({ key: "view" });
  // toolbar, hint and summary 3 + the failed devin (head, source, note) 3 +
  // the live codex (head, source) 2
  expect(seen.rows.at(-1)).toBe(8);
  expect(seen.focused.at(-1)).toBe(true);
  await pane.press({ key: "view" });
  // toolbar and hint 2 + main's header 1 + codex 2 + ls 3 (head, source,
  // output) + a1's header 1 + devin 3
  expect(seen.rows.at(-1)).toBe(12);
  expect(seen.opened).toEqual(["shell-watch", "shell-watch", "shell-watch"]);
});

test("/shell-watch runners | agents | bare: sets the view, opens, bare keeps it", async ($, on) => {
  const seen = await withRunners($, on);
  const pane = await paneOf($, "terminal");
  const view = async (): Promise<string | undefined> => labelOf(pane, "view");
  expect(await view()).toBe("r runners");
  const answer = await $.command.run({ ...RUN, args: "runners" });
  expect(seen.opened).toEqual(["shell-watch"]);
  expect(seen.rows).toEqual([8]);
  expect(answer.text).toContain("keys on the pane");
  expect(await view()).toBe("r agents");
  expect(seen.stored.get("view")).toBe("runners");
  await $.command.run({ ...RUN, args: "" });
  expect(await view()).toBe("r agents");
  await $.command.run({ ...RUN, args: "agents" });
  expect(await view()).toBe("r runners");
  expect(seen.stored.get("view")).toBe("agents");
  await $.command.run({ ...RUN, args: "runners" });
  await $.command.run({ ...RUN, args: "groups" });
  expect(await view()).toBe("r runners");
});

test("the view comes back from the store after a restart", async ($, on) => {
  mock.clock(on);
  const seen = world(on, { paneOpen: true, view: "runners" });
  await $.session.start(START);
  expect(seen.opened).toEqual(["shell-watch"]);
  expect(seen.focused).toEqual([false]);
  expect(await textOf(await paneOf($, "terminal"))).toContain(
    "No runners yet.",
  );
});

test("a closed pane still remembers the view", async ($, on) => {
  mock.clock(on);
  world(on, { paneOpen: false, view: "runners" });
  await $.session.start(START);
  expect(await textOf(await paneOf($, "terminal"))).toContain(
    "No runners yet.",
  );
});

test("a stored view that is neither is the agents view", async ($, on) => {
  mock.clock(on);
  world(on, { view: "nonsense" });
  await $.session.start(START);
  expect(await textOf(await paneOf($, "terminal"))).toContain(
    "No Bash calls yet.",
  );
});
