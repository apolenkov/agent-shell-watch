import { expect, mock, test } from "claude-code/testing";

import { advance } from "./fixtures/advance.ts";
import { notify } from "./fixtures/notify.ts";
import { paneOf } from "./fixtures/pane-of.ts";
import { textOf } from "./fixtures/text-of.ts";
import { world } from "./fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const MIN = 60_000;
// Plain shell calls are watched only under scope: all (runners is the
// default); mechanics tests run in it.
const ALL = { options: { scope: "all" } } as const;
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

test(
  "a Bash call shows while it runs and settles with its exit",
  ALL,
  async ($, on) => {
    const clock = mock.clock(on);
    const seen = world(on);
    on("tool.call", { tool: "Bash" }, async () => {
      await advance(clock, 5000);
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
    expect(seen.statuses).toContain("◐ main · Run tests 0:01");
    await advance(clock, 1000);
    expect(seen.statuses.at(-1)).toBeUndefined();
    expect(await textOf(await paneOf($, "terminal"))).toContain(
      "0:05 exit 0\nRun tests",
    );
  },
);

test(
  "a failed call stays on the status line for 2 minutes",
  ALL,
  async ($, on) => {
    const clock = mock.clock(on);
    const seen = world(on);
    on("tool.call", { tool: "Bash" }, () => ({
      isError: true,
      result: "Exit code 2",
      text: "Exit code 2\nerror TS2322",
    }));
    await $.session.start(START);
    await $.tool.call({
      tool: "Bash",
      command: "tsc",
      description: "Typecheck",
    });
    await advance(clock, 1000);
    expect(seen.statuses.at(-1)).toBe("✗ main · Typecheck exit 2");
    await advance(clock, 2 * MIN);
    expect(seen.statuses.at(-1)).toBeUndefined();
  },
);

test(
  "a background run keeps running until its notification",
  ALL,
  async ($, on) => {
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
    await advance(clock, 1000);
    expect(seen.statuses.at(-1)).toBe("◐ main · E2E 0:01 · no output · 1s");
    const pane = await paneOf($, "terminal");
    expect(await textOf(pane)).toContain("bg · npm run e2e");
    await notify($, NOTICE);
    await advance(clock, 1000);
    expect(seen.statuses.at(-1)).toBe("✗ main · E2E exit 3");
    expect(await textOf(pane)).toContain("0:01 exit 3\nE2E");
  },
);

// quietMin 0.05 and hangMin 0.1: quiet after 3 s, hung after 6 s, so a test
// fires a handful of timers, not hundreds.
const FAST = { options: { quietMin: 0.05, hangMin: 0.1 } };
const FAST_ALL = { options: { ...FAST.options, scope: "all" } } as const;

test(
  "the poller moves a silent run to quiet, then hung",
  FAST_ALL,
  async ($, on) => {
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
    await advance(clock, 2000);
    expect(seen.statuses.at(-1)).toBe("◐ main · Wait 0:02 · output 2s ago");
    await advance(clock, 2000);
    expect(seen.statuses.at(-1)).toBe("⚠ quiet 4s main · Wait 0:04");
    await advance(clock, 4000);
    expect(seen.statuses.at(-1)).toBe("⚠ hung 8s main · Wait");
  },
);

test(
  "a missing watch file is silence from the start, not a failure",
  FAST,
  async ($, on) => {
    const clock = mock.clock(on);
    const seen = world(on);
    on("tool.call", { tool: "Bash" }, async () => {
      await advance(clock, 7000);
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
    expect(seen.statuses).toContain(
      "◐ main · codex · Review 0:02 · no output · 2s",
    );
    expect(seen.statuses).toContain("⚠ quiet 4s main · codex · Review 0:04");
    expect(await textOf(await paneOf($, "terminal"))).toContain(
      "0:07 DONE 0\ncodex · Review",
    );
  },
);

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
  await advance(clock, 4000);
  expect(seen.statuses.at(-1)).toBe(
    "◐ main · pi · Pi fix 0:04 · output 2s ago · › patching src/a.ts",
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
  await advance(clock, 2000);
  expect(seen.statuses.at(-1)).toBe(
    "✗ main · devin · Go RATE_LIMIT 1790000000",
  );
});

test(
  "after a reload the poller resumes running calls",
  FAST_ALL,
  async ($, on) => {
    const clock = mock.clock(on);
    const seen = world(on);
    seen.files.set("/t/b1.output", { size: 1, mtimeMs: 0 });
    on("tool.call", { tool: "Bash" }, () => BG_RESULT);
    await $.session.start(START);
    await $.tool.call({
      tool: "Bash",
      command: "sleep 9",
      description: "Wait",
    });
    await $.session.start(START);
    await advance(clock, 4000);
    expect(seen.statuses.at(-1)).toMatch(/^⚠ quiet 4s main · Wait/u);
  },
);

test("a foreground runner's live line comes from its watch file", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.files.set("/t/w.log", { size: 5, mtimeMs: 1000 });
  seen.tails.set("/t/w.log", "thinking\nediting src/b.ts\n");
  on("tool.call", { tool: "Bash" }, async () => {
    await advance(clock, 3000);
    return {
      result: { stdout: "DONE 0\n", stderr: "", interrupted: false },
      text: "DONE 0",
    };
  });
  await $.session.start(START);
  await $.tool.call({
    tool: "Bash",
    command: "codex exec review > /t/w.log 2>&1",
    description: "Review",
  });
  expect(seen.statuses).toContain(
    "◐ main · codex · Review 0:02 · output 1s ago · › editing src/b.ts",
  );
});
