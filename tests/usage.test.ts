import type { FsEntry } from "claude-code";
import { type Engine, expect, mock, test } from "claude-code/testing";

import { advance } from "./fixtures/advance.ts";
import { paneOf } from "./fixtures/pane-of.ts";
import { textOf } from "./fixtures/text-of.ts";
import {
  CODEX_FIRST,
  CODEX_SECOND,
  PI_USAGES,
  piLine,
} from "./fixtures/usage.ts";
import { world } from "./fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const SURFACES = ["terminal", "desktop"] as const;
const NOW = new Date(2026, 9, 5, 18, 0).getTime();
const PI_ROOT = "/home/t/.pi/agent/sessions";
const PI_DIR = `${PI_ROOT}/--w--`;
const CODEX_DAY = "/home/t/.codex/sessions/2026/10/05";
const BG_TEXT =
  "Command running in background with ID: b1. Output is being written to: /t/b1.output. You will be notified.";
const OPEN_RUNNERS = { paneOpen: true, view: "runners" } as const;
const PI_WINDOW = "262144";
const CODEX_WINDOW = "65536";

const entry = (name: string, over: Partial<FsEntry> = {}): FsEntry => ({
  name,
  kind: "file",
  size: 1000,
  mtimeMs: NOW + 1000,
  isLink: false,
  ...over,
});

// Pi names its file with the UTC start; Codex with the local one.
const piName = (at: number, id = "a"): string =>
  `${new Date(at).toISOString().replaceAll(/[:.]/gu, "-")}_${id}.jsonl`;
const pad = (value: number): string => String(value).padStart(2, "0");
const codexName = (at: number): string => {
  const day = new Date(at);
  const date = `${String(day.getFullYear())}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  const time = `${pad(day.getHours())}-${pad(day.getMinutes())}-${pad(day.getSeconds())}`;
  return `rollout-${date}T${time}-a.jsonl`;
};

const PI_TAIL = PI_USAGES.map((usage) => piLine(usage)).join("\n");

const piWorld = (
  on: Parameters<typeof world>[0],
  stored: Record<string, unknown> = OPEN_RUNNERS,
): ReturnType<typeof world> => {
  const seen = world(on, stored);
  seen.listings.set(PI_ROOT, [
    entry("--w--", { kind: "dir", mtimeMs: NOW + 1000 }),
    entry("--stale--", { kind: "dir", mtimeMs: NOW - 60_000 }),
  ]);
  seen.listings.set(PI_DIR, [entry(piName(NOW + 1000))]);
  // a second candidate in a directory untouched since: it is never listed
  seen.listings.set(`${PI_ROOT}/--stale--`, [entry(piName(NOW + 1200, "s"))]);
  seen.tails.set(`${PI_DIR}/${piName(NOW + 1000)}`, PI_TAIL);
  return seen;
};

const codexWorld = (
  on: Parameters<typeof world>[0],
): ReturnType<typeof world> => {
  const seen = world(on, OPEN_RUNNERS);
  seen.listings.set(CODEX_DAY, [entry(codexName(NOW + 1000))]);
  seen.listings.set("/home/t/.codex/sessions/2026/10/04", []);
  seen.tails.set(
    `${CODEX_DAY}/${codexName(NOW + 1000)}`,
    `cut {"x":\n${CODEX_FIRST}\n${CODEX_SECOND}\n`,
  );
  return seen;
};

const runnerOn = (on: Parameters<typeof world>[0]): void => {
  on("tool.call", { tool: "Bash" }, () => ({
    result: {
      stdout: "",
      stderr: "",
      interrupted: false,
      backgroundTaskId: "b1",
    },
    text: BG_TEXT,
  }));
};

// A background runner starts at NOW; the first poller round runs.
const runWith = async (
  $: Engine,
  on: Parameters<typeof world>[0],
  command: string,
): Promise<ReturnType<typeof mock.clock>> => {
  runnerOn(on);
  const clock = mock.clock(on, { now: NOW });
  await $.session.start(START);
  await $.tool.call({
    tool: "Bash",
    command,
    description: "Run",
    run_in_background: true,
  });
  await advance(clock, 2000);
  return clock;
};

const tails = (seen: ReturnType<typeof world>): readonly string[] =>
  seen.runs.filter((argv) => argv[0] === "tail").map((argv) => argv.join(" "));

for (const surface of SURFACES) {
  test(`${surface}: a Pi runner's head says tokens and dollars summed from its session`, async ($, on) => {
    const seen = piWorld(on);
    await runWith($, on, "pi -p 'x'");
    const text = await textOf(
      await paneOf($, surface, { columns: 100, rows: 30 }),
    );
    expect(text).toContain("← main · 70k tok · $0.003");
    expect(tails(seen)).toEqual([
      `tail -c ${PI_WINDOW} ${PI_DIR}/${piName(NOW + 1000)}`,
    ]);
  });

  test(`${surface}: a Codex runner's head says the total of its last token_count`, async ($, on) => {
    const seen = codexWorld(on);
    await runWith($, on, "codex exec review");
    const text = await textOf(
      await paneOf($, surface, { columns: 100, rows: 30 }),
    );
    expect(text).toContain("← main · 54k tok");
    expect(text).not.toContain("$");
    // the limits reader tails the same newest rollout
    expect(tails(seen)).toContain(
      `tail -c ${CODEX_WINDOW} ${CODEX_DAY}/${codexName(NOW + 1000)}`,
    );
  });

  test(`${surface}: Devin says a dash and reads nothing`, async ($, on) => {
    const seen = piWorld(on);
    await runWith($, on, "devin -p 'x'");
    const text = await textOf(
      await paneOf($, surface, { columns: 100, rows: 30 }),
    );
    expect(text).toContain("← main · —");
    expect(seen.runs).toEqual([]);
  });
}

test("two Pi sessions inside the window are no answer", async ($, on) => {
  const seen = piWorld(on);
  seen.listings.set(PI_DIR, [
    entry(piName(NOW + 1000)),
    entry(piName(NOW + 1500, "b")),
  ]);
  await runWith($, on, "pi -p 'x'");
  expect(await textOf(await paneOf($, "terminal"))).toContain("← main · —");
  expect(tails(seen)).toEqual([]);
});

test("a session file larger than the read window reads at least", async ($, on) => {
  const seen = piWorld(on);
  seen.listings.set(PI_DIR, [entry(piName(NOW + 1000), { size: 300_000 })]);
  await runWith($, on, "pi -p 'x'");
  const pane = await paneOf($, "terminal", { columns: 100, rows: 30 });
  expect(await textOf(pane)).toContain("← main · ≥70k tok · ≥$0.003");
});

test("a session that began before the call is not its session", async ($, on) => {
  const seen = piWorld(on);
  seen.listings.set(PI_DIR, [entry(piName(NOW - 5000))]);
  await runWith($, on, "pi -p 'x'");
  expect(await textOf(await paneOf($, "terminal"))).toContain("← main · —");
  expect(tails(seen)).toEqual([]);
});

test("usage is read at most every 30 seconds while the runner lives", async ($, on) => {
  const seen = piWorld(on);
  const clock = await runWith($, on, "pi -p 'x'");
  expect(tails(seen)).toHaveLength(1);
  await advance(clock, 26_000);
  expect(tails(seen)).toHaveLength(1);
  await advance(clock, 4000);
  expect(tails(seen)).toHaveLength(2);
});

test("a later read that finds nothing keeps the earlier numbers", async ($, on) => {
  const seen = piWorld(on);
  const clock = await runWith($, on, "pi -p 'x'");
  seen.tails.set(`${PI_DIR}/${piName(NOW + 1000)}`, "cut");
  await advance(clock, 30_000);
  expect(tails(seen)).toHaveLength(2);
  const pane = await paneOf($, "terminal", { columns: 100, rows: 30 });
  expect(await textOf(pane)).toContain("← main · 70k tok · $0.003");
});

test("two Codex rollouts inside the window: the nearest to the start wins", async ($, on) => {
  const seen = codexWorld(on);
  seen.listings.set(CODEX_DAY, [
    entry(codexName(NOW + 1000)),
    entry(codexName(NOW + 8000)),
  ]);
  seen.tails.set(`${CODEX_DAY}/${codexName(NOW + 8000)}`, `${CODEX_FIRST}\n`);
  await runWith($, on, "codex exec review");
  const pane = await paneOf($, "terminal", { columns: 100, rows: 30 });
  expect(await textOf(pane)).toContain("← main · 54k tok");
});

test("nothing is read while the agents view is open", async ($, on) => {
  const seen = piWorld(on, { paneOpen: true });
  await runWith($, on, "pi -p 'x'");
  expect(seen.runs).toEqual([]);
});

test("nothing is read while the pane is closed", async ($, on) => {
  const seen = piWorld(on, { paneOpen: false, view: "runners" });
  await runWith($, on, "pi -p 'x'");
  expect(seen.runs).toEqual([]);
});

test("short of width the cell goes first and by stays", async ($, on) => {
  piWorld(on);
  await runWith($, on, "pi -p 'x'");
  const pane = await paneOf($, "terminal", { columns: 56, rows: 30 });
  const text = await textOf(pane);
  expect(text).toContain("← main");
  expect(text).not.toContain("tok");
});
