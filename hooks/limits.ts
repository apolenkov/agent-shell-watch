/**
 * The executors' subscription limits: read here, in the file that holds `$`
 * (the engine follows `$` only into functions of the same file), on a timer
 * of its own started by `session.start`. Only while the pane shows the runners
 * view or a runner is live, and at most every 30 s (`readAt` in the `limits`
 * atom); what the data means is `model/limits.ts`.
 */
import type {
  EngineInterface,
  Next,
  SessionStartInput,
  SessionStartResult,
} from "claude-code";
import { atom, read, update } from "claude-code";

import type { ShellCall, ShellLimits, ShellView } from "../types";
import {
  isLimitsDue,
  LIMIT_NAMES,
  limitPathOf,
  limitsOf,
  newestRolloutOf,
  NO_LIMITS,
  sessionDirectoriesOf,
  TAIL_BYTES,
} from "./model/limits.ts";

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

const CHECK_MS = 2000;

type Engine = Readonly<EngineInterface>;

// A missing file or a failed call is "nothing found", not an error.
const attempt = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await run();
  } catch {
    return undefined;
  }
};

// A rollout is 2 to 10 MB and `$.fs.read` stops at 4 MiB: only its end.
const rolloutTailOf = async (
  $: Engine,
  path: string,
): Promise<string | undefined> => {
  const ran = await attempt(async () =>
    $.process.run(["tail", "-c", TAIL_BYTES, path]),
  );
  return ran?.exitCode === 0 ? ran.stdout : undefined;
};

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
  const listings = await Promise.all(
    sessionDirectoriesOf(home, now).map(async (directory) => ({
      directory,
      entries: (await attempt(async () => $.fs.list(directory))) ?? [],
    })),
  );
  const newest = newestRolloutOf(listings);
  const rollout =
    newest === undefined ? undefined : await rolloutTailOf($, newest);
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
  });
  return started;
};
