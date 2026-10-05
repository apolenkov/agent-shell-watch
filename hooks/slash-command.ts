/**
 * `/shell-watch` (`clear`, `stop`) and the pane's closing by the person.
 */
import type {
  CommandRunInput,
  CommandRunResult,
  EngineInterface,
  Next,
  OpEventResult,
  PaneCloseInput,
} from "claude-code";
import { atom, read, update } from "claude-code";

import type { ShellAgents, ShellCall } from "../types";
import { finishedIds, liveOnly } from "./model/calls.ts";
import { configOf } from "./model/config.ts";
import { groupsOf } from "./model/groups.ts";
import { rowsWantedOf } from "./model/pane-items.ts";

const NO_CALLS: readonly ShellCall[] = [];
const callsAtom = atom(
  { plugin: "agent-shell-watch", key: "calls" } as const,
  NO_CALLS,
);
const NO_IDS: readonly string[] = [];
// The ids `clear` forgot, so a backfill does not bring them back.
const clearedAtom = atom(
  { plugin: "agent-shell-watch", key: "cleared" } as const,
  NO_IDS,
);

const configAtom = atom(
  { plugin: "agent-shell-watch", key: "config" } as const,
  configOf({}),
);
const NO_AGENTS: ShellAgents = {};
const agentsAtom = atom(
  { plugin: "agent-shell-watch", key: "agentInfo" } as const,
  NO_AGENTS,
);
const NO_FOLDS: Readonly<Record<string, boolean>> = {};
const foldsAtom = atom(
  { plugin: "agent-shell-watch", key: "folds" } as const,
  NO_FOLDS,
);
const openAtom = atom(
  { plugin: "agent-shell-watch", key: "isOpen" } as const,
  false,
);
const selectedAtom = atom(
  { plugin: "agent-shell-watch", key: "selected" } as const,
  "",
);

/** The pane's id and the command's name. */
export const PANE = "shell-watch";

// ponytail: the cleared ids list is capped; a transcript keeps 4096 entries.
const CLEARED_MAX = 4096;

const clearCalls = async ($: Readonly<EngineInterface>): Promise<void> => {
  const calls = await read($, callsAtom);
  await update($, clearedAtom, (ids) =>
    [...ids, ...finishedIds(calls)].slice(-CLEARED_MAX),
  );
  await update($, callsAtom, liveOnly);
};

/**
 * `command.run` for `/shell-watch`: opens the pane, `clear` forgets finished
 * calls, `stop` closes the pane.
 * @param $ the engine
 * @param e the command
 * @returns the command's answer
 */
export const onCommand = async (
  $: Readonly<EngineInterface>,
  e: Readonly<CommandRunInput>,
): Promise<CommandRunResult> => {
  const argument = e.args.trim().toLowerCase();
  if (argument === "stop" || argument === "close") {
    await $.store.set("paneOpen", false);
    await update($, openAtom, () => false);
    await $.ui.close({ id: PANE });
    return { text: "closed" };
  }
  if (argument === "clear") {
    await clearCalls($);
    await update($, selectedAtom, () => "");
    return { text: "finished calls cleared" };
  }
  const { columns } = await read($, configAtom);
  const rows = rowsWantedOf(
    groupsOf(
      await read($, callsAtom),
      await read($, agentsAtom),
      await $.clock.now(),
    ),
    await read($, foldsAtom),
  );
  const opened = await $.ui.open({
    id: PANE,
    title: "shell-watch",
    columns,
    rows,
    focus: true,
  });
  await update($, openAtom, () => true);
  await $.store.set("paneOpen", true);
  return {
    text: opened.isPlaced
      ? "keys on the pane · Esc → prompt · /shell-watch again refocuses"
      : "the pane waits for room",
  };
};

/**
 * `ui.close`: when the person closes the pane it is no longer open.
 * @param $ the engine
 * @param e the close
 * @param next the rest of the chain
 * @returns what the chain answered
 */
export const onClose = async (
  $: Readonly<EngineInterface>,
  e: Readonly<PaneCloseInput>,
  next: Next<"ui.close">,
): Promise<OpEventResult<"ui.close">> => {
  // An unload (a reload, the session's end) is no choice of the person's.
  if (e.id === PANE && e.origin.kind !== "unload") {
    await update($, openAtom, () => false);
    await $.store.set("paneOpen", false);
  }
  return next(e);
};
