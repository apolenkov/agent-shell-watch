import type { FsEntry } from "claude-code";
import { type Engine, expect, mock, test } from "claude-code/testing";

import { limitTimeOf } from "../hooks/model/limits.ts";
import { advance } from "./fixtures/advance.ts";
import { TOKEN_COUNT_FULL, TOKEN_COUNT_NO_PRIMARY } from "./fixtures/limits.ts";
import { paneOf } from "./fixtures/pane-of.ts";
import { textOf } from "./fixtures/text-of.ts";
import { world } from "./fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const SURFACES = ["terminal", "desktop"] as const;
// 2026-10-05 18:00 in the host's zone; the rollout's reset is 2026-10-10.
const NOW = new Date(2026, 9, 5, 18, 0).getTime();
const RESETS_AT = 1_791_640_084_000;
const HOUR_MS = 3_600_000;
const STATE = "/home/t/.local/state/executor-limits";
const TODAY = "/home/t/.codex/sessions/2026/10/05";
const ROLLOUT = `${TODAY}/rollout-2026-10-05T16-48-52-x.jsonl`;
const BG_TEXT =
  "Command running in background with ID: b1. Output is being written to: /t/b1.output. You will be notified.";

const entry = (name: string, mtimeMs: number): FsEntry => ({
  name,
  kind: "file",
  size: 1,
  mtimeMs,
  isLink: false,
});

/** The owner's day: Codex's newest rollout says 100% with the reset ahead. */
const withLimits = (
  on: Parameters<typeof world>[0],
  stored: Record<string, unknown>,
): ReturnType<typeof world> => {
  const seen = world(on, stored);
  seen.texts.set(`${STATE}/pi`, "not an epoch");
  seen.listings.set(TODAY, [
    entry("rollout-2026-10-05T10-00-00-old.jsonl", 100),
    entry("rollout-2026-10-05T16-48-52-x.jsonl", 900),
    entry("notes.txt", 5000),
  ]);
  seen.listings.set("/home/t/.codex/sessions/2026/10/04", []);
  seen.tails.set(
    ROLLOUT,
    `cut off mid-line {"x":\n${TOKEN_COUNT_FULL}\n${TOKEN_COUNT_NO_PRIMARY}\n`,
  );
  return seen;
};

// The session starts and the poller makes its first round.
const started = async (
  $: Engine,
  on: Parameters<typeof world>[0],
): Promise<void> => {
  const clock = mock.clock(on, { now: NOW });
  await $.session.start(START);
  await advance(clock, 2000);
};

const OPEN_RUNNERS = { paneOpen: true, view: "runners" } as const;

for (const surface of SURFACES) {
  test(`${surface}: the runners view shows the limits line under the summary`, async ($, on) => {
    const seen = withLimits(on, OPEN_RUNNERS);
    seen.texts.set(`${STATE}/devin`, `${String((NOW + HOUR_MS) / 1000)}\n`);
    await started($, on);
    const until = limitTimeOf(RESETS_AT, NOW);
    const devin = limitTimeOf(NOW + HOUR_MS, NOW);
    const text = await textOf(await paneOf($, surface));
    expect(text).toContain("No runners yet.");
    expect(text).toContain(
      `limits: devin limit until ${devin} · pi ok · codex 100% until ${until}`,
    );
  });

  test(`${surface}: before the first read the line says so`, async ($, on) => {
    mock.clock(on, { now: NOW });
    world(on, { view: "runners" });
    await $.session.start(START);
    expect(await textOf(await paneOf($, surface))).toContain("limits: …");
  });
}

test("the rollout's end is read with tail -c, from the newest file of today", async ($, on) => {
  const seen = withLimits(on, OPEN_RUNNERS);
  await started($, on);
  expect(seen.runs).toContainEqual(["tail", "-c", "65536", ROLLOUT]);
  expect(seen.reads).toContain(`${STATE}/codex`);
  expect(seen.reads).not.toContain(ROLLOUT);
});

const OLD = `${TODAY}/rollout-2026-10-05T10-00-00-old.jsonl`;
const codexCell = async (
  $: Engine,
  on: Parameters<typeof world>[0],
  tails: Readonly<Record<string, string>>,
): Promise<string> => {
  const seen = withLimits(on, OPEN_RUNNERS);
  for (const [path, tail] of Object.entries(tails)) {
    seen.tails.set(path, tail);
  }
  await started($, on);
  return textOf(await paneOf($, "terminal"));
};

test("a newest rollout with no primary keeps the block of the one before it", async ($, on) => {
  const text = await codexCell($, on, {
    [ROLLOUT]: TOKEN_COUNT_NO_PRIMARY,
    [OLD]: TOKEN_COUNT_FULL,
  });
  expect(text).toContain(`codex 100% until ${limitTimeOf(RESETS_AT, NOW)}`);
});

test("no primary in any of the newest rollouts reads as ok", async ($, on) => {
  const text = await codexCell($, on, {
    [ROLLOUT]: TOKEN_COUNT_NO_PRIMARY,
    [OLD]: TOKEN_COUNT_NO_PRIMARY,
  });
  expect(text).toContain("codex ok");
});

test("only the three newest rollouts are looked at", async ($, on) => {
  const seen = withLimits(on, OPEN_RUNNERS);
  seen.listings.set(TODAY, [
    entry("rollout-a.jsonl", 10),
    entry("rollout-b.jsonl", 20),
    entry("rollout-c.jsonl", 30),
    entry("rollout-d.jsonl", 40),
  ]);
  seen.tails.set(`${TODAY}/rollout-a.jsonl`, TOKEN_COUNT_FULL);
  await started($, on);
  expect(await textOf(await paneOf($, "terminal"))).toContain("codex ok");
});

test("an active limit adds ⏳ to the status line when a read finds it", async ($, on) => {
  const seen = withLimits(on, OPEN_RUNNERS);
  seen.tails.set(
    ROLLOUT,
    TOKEN_COUNT_FULL.replace('"used_percent":100.0', '"used_percent":42.0'),
  );
  const clock = mock.clock(on, { now: NOW });
  await $.session.start(START);
  await advance(clock, 3000);
  expect(seen.statuses.at(-1)).toBeUndefined();
  seen.tails.set(ROLLOUT, TOKEN_COUNT_FULL);
  // the next read is due 30 s after the first
  await advance(clock, 30_000);
  expect(seen.statuses.at(-1)).toBe("⏳ codex limit");
});

test("the ⏳ goes when the block ends, without another read", async ($, on) => {
  const seen = withLimits(on, OPEN_RUNNERS);
  seen.tails.set(ROLLOUT, TOKEN_COUNT_NO_PRIMARY);
  seen.texts.set(`${STATE}/devin`, `${String((NOW + 20_000) / 1000)}\n`);
  const clock = mock.clock(on, { now: NOW });
  await $.session.start(START);
  await advance(clock, 3000);
  expect(seen.statuses.at(-1)).toBe("⏳ devin limit");
  await advance(clock, 19_000);
  expect(seen.statuses.at(-1)).toBeUndefined();
});

test("a live runner's status line carries the limit too", async ($, on) => {
  const seen = withLimits(on, {});
  on("tool.call", { tool: "Bash" }, () => ({
    result: {
      stdout: "",
      stderr: "",
      interrupted: false,
      backgroundTaskId: "b1",
    },
    text: BG_TEXT,
  }));
  const clock = mock.clock(on, { now: NOW });
  await $.session.start(START);
  await $.tool.call({
    tool: "Bash",
    command: "codex exec review",
    description: "Codex review",
    run_in_background: true,
  });
  await advance(clock, 2000);
  expect(seen.statuses.at(-1)).toMatch(
    /^◐ main · codex · Codex review .* · ⏳ codex limit$/u,
  );
});

test("limits are read at most every 30 seconds", async ($, on) => {
  const seen = withLimits(on, OPEN_RUNNERS);
  const clock = mock.clock(on, { now: NOW });
  await $.session.start(START);
  const codexReads = (): number =>
    seen.reads.filter((path) => path === `${STATE}/codex`).length;
  await advance(clock, 2000);
  expect(codexReads()).toBe(1);
  await advance(clock, 26_000);
  expect(codexReads()).toBe(1);
  await advance(clock, 2000);
  expect(codexReads()).toBe(1);
  await advance(clock, 2000);
  expect(codexReads()).toBe(2);
  await advance(clock, 30_000);
  expect(codexReads()).toBe(3);
});

test("nothing is read while the agents view is open and no runner is live", async ($, on) => {
  const seen = withLimits(on, { paneOpen: true });
  const clock = mock.clock(on, { now: NOW });
  await $.session.start(START);
  await advance(clock, 10_000);
  expect(seen.reads).toEqual([]);
  expect(seen.runs).toEqual([]);
});

test("a live runner makes the poller read, with the pane closed", async ($, on) => {
  const seen = withLimits(on, { paneOpen: false });
  on("tool.call", { tool: "Bash" }, () => ({
    result: {
      stdout: "",
      stderr: "",
      interrupted: false,
      backgroundTaskId: "b1",
    },
    text: BG_TEXT,
  }));
  const clock = mock.clock(on, { now: NOW });
  await $.session.start(START);
  await $.tool.call({
    tool: "Bash",
    command: "pi -p 'x'",
    description: "Pi run",
    run_in_background: true,
  });
  await advance(clock, 2000);
  expect(seen.reads).toContain(`${STATE}/pi`);
});

test("no limits files and no rollout directory read as ok", async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  const seen = world(on, OPEN_RUNNERS);
  await $.session.start(START);
  await advance(clock, 2000);
  expect(seen.reads.length).toBe(3);
  expect(await textOf(await paneOf($, "terminal"))).toContain(
    "limits: devin ok · pi ok · codex ok",
  );
  expect(seen.statuses.at(-1)).toBeUndefined();
});
