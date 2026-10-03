import { expect, mock, test } from "claude-code/testing";

import { notify } from "./fixtures/notify.ts";
import { paneOf } from "./fixtures/pane-of.ts";
import { textOf } from "./fixtures/text-of.ts";
import { world } from "./fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const MIN = 60_000;
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
const NOTICE =
  '<task-notification>\n<task-id>b1</task-id>\n<status>failed</status>\n<summary>Background command "x" failed with exit code 3</summary>\n</task-notification>';

test("a Bash call shows while it runs and settles with its exit", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  on("tool.call", { tool: "Bash" }, async () => {
    await clock.advance(5000);
    return {
      result: { stdout: "ok\n", stderr: "", interrupted: false },
      text: "ok",
    };
  });
  await $.session.start(START);
  await $.tool.call({
    tool: "Bash",
    command: "npm test",
    description: "Run tests",
  });
  expect(seen.statuses).toContain("shell: ◐ Run tests 0:01");
  await clock.advance(1000);
  expect(seen.statuses.at(-1)).toBeUndefined();
  expect(await textOf(await paneOf($, "terminal"))).toContain(
    "0:05  Run tests  exit 0",
  );
});

test("a failed call stays on the status line for 2 minutes", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  on("tool.call", { tool: "Bash" }, () => ({
    isError: true,
    result: "Exit code 2",
    text: "Exit code 2\nerror TS2322",
  }));
  await $.session.start(START);
  await $.tool.call({ tool: "Bash", command: "tsc", description: "Typecheck" });
  await clock.advance(1000);
  expect(seen.statuses.at(-1)).toBe("shell: ✗ Typecheck exit 2");
  await clock.advance(2 * MIN);
  expect(seen.statuses.at(-1)).toBeUndefined();
});

test("a background run keeps running until its notification", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  on("tool.call", { tool: "Bash" }, () => BG_RESULT);
  await $.session.start(START);
  await $.tool.call({
    tool: "Bash",
    command: "npm run e2e",
    description: "E2E",
    run_in_background: true,
  });
  await clock.advance(1000);
  expect(seen.statuses.at(-1)).toBe("shell: ◐ E2E 0:01");
  const pane = await paneOf($, "terminal");
  expect(await textOf(pane)).toContain("bg · main · npm run e2e");
  await notify($, NOTICE);
  await clock.advance(1000);
  expect(seen.statuses.at(-1)).toBe("shell: ✗ E2E exit 3");
  expect(await textOf(pane)).toContain("E2E  exit 3");
});

test("the poller moves a silent run to quiet, then hung", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.files.set("/t/b1.output", { size: 10, mtimeMs: 0 });
  on("tool.call", { tool: "Bash" }, () => BG_RESULT);
  await $.session.start(START);
  await $.tool.call({
    tool: "Bash",
    command: "sleep 1000",
    description: "Wait",
  });
  await clock.advance(2000);
  expect(seen.statuses.at(-1)).toBe("shell: ◐ Wait 0:02 · output 2s ago");
  await clock.advance(5 * MIN);
  expect(seen.statuses.at(-1)).toBe("shell: ⚠ quiet 5m Wait 5:02");
  await clock.advance(5 * MIN);
  expect(seen.statuses.at(-1)).toBe("shell: ⚠ hung 10m Wait");
});

test("a missing watch file is silence from the start, not a failure", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  on("tool.call", { tool: "Bash" }, async () => {
    await clock.advance(6 * MIN);
    return {
      result: { stdout: "work\nDONE 0\n", stderr: "", interrupted: false },
      text: "work\nDONE 0",
    };
  });
  await $.session.start(START);
  await $.tool.call({
    tool: "Bash",
    command: "node w.ts --watch-file /t/none.log -- codex exec go",
    description: "Review",
  });
  expect(seen.statuses).toContain("shell: ◐ codex · Review 2:00");
  expect(seen.statuses).toContain("shell: ⚠ quiet 6m codex · Review 6:00");
  expect(await textOf(await paneOf($, "terminal"))).toContain(
    "6:00  codex · Review  DONE 0",
  );
});

test("a runner's last line and freshness lead the status line", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  on("tool.call", { tool: "Bash" }, () => BG_RESULT);
  await $.session.start(START);
  await $.tool.call({
    tool: "Bash",
    command: "FOO=1 pi -p 'fix the bug'",
    description: "Pi fix",
  });
  seen.files.set("/t/b1.output", { size: 30, mtimeMs: 1500 });
  seen.tails.set("/t/b1.output", "reading\npatching src/a.ts\n");
  await clock.advance(4000);
  expect(seen.statuses.at(-1)).toBe(
    "shell: ◐ pi · Pi fix 0:04 · output 2s ago · › patching src/a.ts",
  );
});

test("a runner's verdict is read once its background run ends", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  on("tool.call", { tool: "Bash" }, () => BG_RESULT);
  await $.session.start(START);
  await $.tool.call({
    tool: "Bash",
    command: "devin -p go",
    description: "Go",
  });
  seen.tails.set("/t/b1.output", "work\nRATE_LIMIT 1790000000\n");
  await notify($, NOTICE);
  await clock.advance(2000);
  expect(seen.statuses.at(-1)).toBe(
    "shell: ✗ devin · Go RATE_LIMIT 1790000000",
  );
});

test("after a reload the poller resumes running calls", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.files.set("/t/b1.output", { size: 1, mtimeMs: 0 });
  on("tool.call", { tool: "Bash" }, () => BG_RESULT);
  await $.session.start(START);
  await $.tool.call({ tool: "Bash", command: "sleep 9", description: "Wait" });
  await $.session.start(START);
  await clock.advance(6 * MIN);
  expect(seen.statuses.at(-1)).toMatch(/^shell: ⚠ quiet 6m Wait/u);
});
