/**
 * The executors' subscription limits and the runners' tokens and cost: read
 * here, in the file that holds `$` (the engine follows `$` only into functions
 * of the same file), on a timer of its own started by `session.start`. Limits
 * only while the pane shows the runners view or a runner is live, and at most
 * every 30 s (`readAt` in the `limits` atom); usage only while the pane shows
 * the runners view, for the runners it shows, at most every 30 s per call
 * (`readAt` in the `usage` atom). What the data means is `model/limits.ts` and
 * `model/usage.ts`.
 */
import type {
  EngineInterface,
  Next,
  SessionStartInput,
  SessionStartResult,
} from "claude-code";
import { atom, read, update } from "claude-code";

import type {
  CallUsage,
  ShellCall,
  ShellLimits,
  ShellUsage,
  ShellView,
} from "../types";
import {
  hasPrimary,
  isLimitsDue,
  LIMIT_NAMES,
  limitPathOf,
  limitsOf,
  type Listing,
  newestRolloutsOf,
  NO_LIMITS,
  sessionDirectoriesOf,
  TAIL_BYTES,
} from "./model/limits.ts";
import { shownRunnerCallsOf } from "./model/pane-items.ts";
import {
  CODEX_TAIL_BYTES,
  codexFilesOf,
  dueUsageOf,
  type Found,
  keptWhenEmpty,
  PI_TAIL_BYTES,
  pickSession,
  piDirectoriesOf,
  piFilesOf,
  type SessionFile,
  usageFrom,
  windowOf,
} from "./model/usage.ts";

const NO_CALLS: readonly ShellCall[] = [];
const callsAtom = atom(
  { plugin: "agent-shell-watch", key: "calls" } as const,
  NO_CALLS,
);
const viewAtom = atom(
  { plugin: "agent-shell-watch", key: "view" } as const,
  "agents" as ShellView,
);
const openAtom = atom(
  { plugin: "agent-shell-watch", key: "isOpen" } as const,
  false,
);
const limitsAtom = atom(
  { plugin: "agent-shell-watch", key: "limits" } as const,
  NO_LIMITS,
);

const NO_USAGE: ShellUsage = {};
const usageAtom = atom(
  { plugin: "agent-shell-watch", key: "usage" } as const,
  NO_USAGE,
);

const CHECK_MS = 2000;
const SLACK_MS = 2000;
const ROLLOUTS_LOOKED_AT = 3;

type Engine = Readonly<EngineInterface>;

// A missing file or a failed call is "nothing found", not an error.
const attempt = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await run();
  } catch {
    return undefined;
  }
};

// A session file is 2 to 10 MB and `$.fs.read` stops at 4 MiB: only its end.
const endOf = async (
  $: Engine,
  path: string,
  bytes: string,
): Promise<string | undefined> => {
  const ran = await attempt(async () =>
    $.process.run(["tail", "-c", bytes, path]),
  );
  return ran?.exitCode === 0 ? ran.stdout : undefined;
};

const listingsOf = async (
  $: Engine,
  directories: readonly string[],
): Promise<readonly Listing[]> =>
  Promise.all(
    directories.map(async (directory) => ({
      directory,
      entries: (await attempt(async () => $.fs.list(directory))) ?? [],
    })),
  );

const readLimits = async (
  $: Engine,
  home: string,
  now: number,
): Promise<ShellLimits["by"]> => {
  const texts = await Promise.all(
    LIMIT_NAMES.map(async (name) =>
      attempt(async () => $.fs.read(limitPathOf(home, name))),
    ),
  );
  const listings = await listingsOf($, sessionDirectoriesOf(home, now));
  // A run stopped at a spend cap leaves a rollout with no `primary`: the
  // first of the newest few that has one speaks.
  const tails = await Promise.all(
    newestRolloutsOf(ROLLOUTS_LOOKED_AT, listings).map(async (path) =>
      endOf($, path, TAIL_BYTES),
    ),
  );
  const rollout = tails.find((tail) => tail !== undefined && hasPrimary(tail));
  return limitsOf({ texts, rollout }, now);
};

const refreshLimits = async ($: Engine): Promise<void> => {
  const now = await $.clock.now();
  const { readAt } = await read($, limitsAtom);
  const isDue = isLimitsDue({
    view: await read($, viewAtom),
    isOpen: await read($, openAtom),
    calls: await read($, callsAtom),
    readAt,
    now,
  });
  const home = isDue ? await attempt(async () => $.env.get("HOME")) : undefined;
  if (home === undefined || home === "") {
    return;
  }
  // Stamped first: a slow read is not started twice.
  await update($, limitsAtom, (known) => ({ ...known, readAt: now }));
  const by = await readLimits($, home, now);
  await update($, limitsAtom, () => ({ readAt: now, by }));
};

const mtimeOf = async ($: Engine, path: string): Promise<number> => {
  const stat = await attempt(async () => $.fs.stat(path));
  return stat?.mtimeMs ?? 0;
};

// Pi keeps a directory per cwd, which a call does not know: list those
// touched since the earliest due call began, then the files in them.
const piFilesIn = async (
  $: Engine,
  home: string,
  since: number,
): Promise<readonly SessionFile[]> => {
  const root = `${home}/.pi/agent/sessions`;
  const [top] = await listingsOf($, [root]);
  // `$.fs.list` has mtimeMs 0 for a directory: `$.fs.stat` has the real one.
  const stats = await Promise.all(
    (top?.entries ?? [])
      .filter((entry) => entry.kind === "dir")
      .map(async ({ name }) => ({
        name,
        mtimeMs: await mtimeOf($, `${root}/${name}`),
      })),
  );
  return piFilesOf(
    await listingsOf(
      $,
      piDirectoriesOf(stats, since).map((name) => `${root}/${name}`),
    ),
  );
};

const foundFor = async (
  $: Engine,
  call: ShellCall,
  file: SessionFile | undefined,
): Promise<Found> => {
  const { runner } = call;
  const bytes = runner === "pi" ? PI_TAIL_BYTES : CODEX_TAIL_BYTES;
  return runner === undefined || file === undefined
    ? {}
    : usageFrom(runner, await endOf($, file.path, bytes), file.size);
};

// Pi's session must be the only one in the window; Codex's the nearest start.
const sessionOf = (
  call: ShellCall,
  files: Readonly<Record<"pi" | "codex", readonly SessionFile[]>>,
  now: number,
): SessionFile | undefined => {
  const window = windowOf(call, now);
  const own = call.runner === "pi" ? files.pi : files.codex;
  const near = call.runner === "codex" ? call.startedAt : undefined;
  return window === undefined ? undefined : pickSession(own, window, near);
};

const readUsage = async (
  $: Engine,
  due: readonly ShellCall[],
  { home, now }: Readonly<{ home: string; now: number }>,
): Promise<ShellUsage> => {
  const since = Math.min(...due.map((call) => call.startedAt)) - SLACK_MS;
  const files = {
    pi: due.some((call) => call.runner === "pi")
      ? await piFilesIn($, home, since)
      : [],
    codex: codexFilesOf(
      due.some((call) => call.runner === "codex")
        ? await listingsOf($, sessionDirectoriesOf(home, now))
        : [],
    ),
  };
  const entries = await Promise.all(
    due.map(async (call): Promise<readonly [string, CallUsage]> => {
      const file = sessionOf(call, files, now);
      return [call.id, { ...(await foundFor($, call, file)), readAt: now }];
    }),
  );
  return Object.fromEntries(entries);
};

const refreshUsage = async ($: Engine): Promise<void> => {
  const isShown =
    (await read($, openAtom)) && (await read($, viewAtom)) === "runners";
  const now = await $.clock.now();
  const due = isShown
    ? dueUsageOf(
        shownRunnerCallsOf(await read($, callsAtom)),
        await read($, usageAtom),
        now,
      )
    : [];
  const home =
    due.length > 0 ? await attempt(async () => $.env.get("HOME")) : "";
  if (home === undefined || home === "" || due.length === 0) {
    return;
  }
  // Stamped first: a slow read is not started twice.
  await update($, usageAtom, (known) => ({
    ...known,
    ...Object.fromEntries(
      due.map((call) => [call.id, { ...known[call.id], readAt: now }]),
    ),
  }));
  const found = await readUsage($, due, { home, now });
  // Only the calls still listed keep a cell (`clear` forgets the rest).
  const listed = await read($, callsAtom);
  const ids = new Set(listed.map((call) => call.id));
  await update($, usageAtom, (known) =>
    Object.fromEntries(
      Object.entries({ ...known, ...keptWhenEmpty(known, found) }).filter(
        ([id]) => ids.has(id),
      ),
    ),
  );
};

/**
 * `session.start`: starts the limits timer (it fires again on a hot reload,
 * which dropped the timers).
 * @param $ the engine
 * @param e the start
 * @param next the rest of the chain
 * @returns what the chain answered
 */
export const onLimitsStart = async (
  $: Engine,
  e: Readonly<SessionStartInput>,
  next: Next<"session.start">,
): Promise<SessionStartResult> => {
  const started = await next(e);
  $.clock.every(CHECK_MS, () => {
    void refreshLimits($);
    void refreshUsage($);
  });
  return started;
};
