import { expect, mock, test } from "claude-code/testing";

import { paneOf } from "./fixtures/pane-of.ts";
import { textOf } from "./fixtures/text-of.ts";
import { world } from "./fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const RUN = {
  command: "shell-watch",
  args: "",
  origin: { kind: "composer" },
  presentation: { isFullscreen: true, columns: 160 },
} as const;

const bg = (
  id: string,
  task: string,
  description: string,
): Record<string, unknown> => ({
  tool_use_id: id,
  tool: "Bash",
  input: { command: `run ${task}`, description, run_in_background: true },
  result: {
    stdout: "",
    stderr: "",
    interrupted: false,
    backgroundTaskId: task,
  },
  text: `Command running in background with ID: ${task}. Output is being written to: /t/${task}.output.`,
});

const MAIN = [
  {
    role: "assistant",
    text: "",
    toolUses: [bg("u1", "b1", "E2E"), bg("u2", "b2", "Wait")],
  },
  {
    role: "user",
    text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Background command "x" completed (exit code 0)</summary>\n</task-notification>',
    toolUses: [],
  },
];

const RUNNER = [
  {
    role: "assistant",
    text: "",
    toolUses: [
      {
        tool_use_id: "p1",
        tool: "Bash",
        input: { command: "pi -p 'list mods' 2>&1 | tee /t/p.log" },
        result: { stdout: "work\nDONE 0\n", stderr: "", interrupted: false },
        text: "work\nDONE 0",
      },
    ],
  },
];

const AGENTS = [
  { id: "a1", description: "List mods", type: "pi-runner", status: "running" },
  { id: "a2", description: "Old", type: "Explore", status: "completed" },
];

test("calls made before the mod loaded are rebuilt once, reload or not", async ($, on) => {
  mock.clock(on);
  const seen = world(on, {}, AGENTS);
  seen.transcripts.set("", MAIN);
  seen.transcripts.set("a1", RUNNER);
  seen.transcripts.set("a2", [
    { role: "assistant", text: "", toolUses: [bg("o1", "b9", "Never")] },
  ]);
  await $.session.start(START);
  await $.session.start(START);
  const pane = await paneOf($, "terminal");
  const text = await textOf(pane);
  expect(text).toContain("— exit 0\nE2E");
  expect(text).toContain("— no output\nWait");
  expect(text).toContain("— DONE 0\npi · list mods");
  expect(text).toContain("pi-runner: List mods");
  expect(text).not.toContain("Never");
  const buttons = await pane.findAll({ type: "Button" });
  const rows = buttons.filter(
    (button) => button.key?.startsWith("row:") === true,
  );
  expect(rows).toHaveLength(3);
});

test("opening the pane picks up what the transcript gained", async ($, on) => {
  mock.clock(on);
  const seen = world(on);
  await $.session.start(START);
  seen.transcripts.set("", MAIN);
  await $.command.run(RUN);
  expect(await textOf(await paneOf($, "terminal"))).toContain("Wait");
});

test("cleared calls stay cleared when the pane opens again", async ($, on) => {
  mock.clock(on);
  const seen = world(on);
  seen.transcripts.set("", MAIN);
  await $.session.start(START);
  await $.command.run({ ...RUN, args: "clear" });
  await $.command.run(RUN);
  const text = await textOf(await paneOf($, "terminal"));
  expect(text).not.toContain("E2E");
  expect(text).toContain("Wait");
});
