/**
 * `/shell-watch` (`runners`, `agents`, `clear`, `stop`), the pane's height
 * and re-opening, and the pane's closing by the person.
 */
import type {
  CommandRunInput,
  CommandRunResult,
  EngineInterface,
  Next,
  OpEventResult,
  PaneCloseInput,
  UiOpenResult,
} from "claude-code";
import { atom, read, update } from "claude-code";

import type { ShellAgents, ShellCall, ShellView } from "../types";
import { finishedIds, liveOnly } from "./model/calls.ts";
import { configOf } from "./model/config.ts";
import { rowsWantedFor } from "./model/pane-items.ts";

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
const viewAtom = atom(
  { plugin: "agent-shell-watch", key: "view" } as const,
  "agents" as ShellView,
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

const VIEWS: Readonly<Partial<Record<string, ShellView>>> = {
  runners: "runners",
  agents: "agents",
  groups: "agents",
};

// ponytail: the cleared ids list is capped; a transcript keeps 4096 entries.
const CLEARED_MAX = 4096;

const clearCalls = async ($: Readonly<EngineInterface>): Promise<void> => {
  const calls = await read($, callsAtom);
  await update($, clearedAtom, (ids) =>
    [...ids, ...finishedIds(calls)].slice(-CLEARED_MAX),
  );
  await update($, callsAtom, liveOnly);
};

const rowsWantedNow = async ($: Readonly<EngineInterface>): Promise<number> =>
  rowsWantedFor({
    view: await read($, viewAtom),
    calls: await read($, callsAtom),
    agents: await read($, agentsAtom),
    folds: await read($, foldsAtom),
    now: await $.clock.now(),
  });

// An inline pane got its height at open ("each open sets it anew"): ask again.
const reopen = async ($: Readonly<EngineInterface>): Promise<UiOpenResult> => {
  const { columns } = await read($, configAtom);
  return $.ui.open({
    id: PANE,
    title: PANE,
    columns,
    rows: await rowsWantedNow($),
    focus: true,
  });
};

const setView = async (
  $: Readonly<EngineInterface>,
  view: ShellView,
): Promise<void> => {
  await update($, viewAtom, () => view);
  await $.store.set("view", view);
};

/**
 * `command.run` for `/shell-watch`: opens the pane (`runners`, `agents` or
 * `groups` pick its view, bare keeps it), `clear` forgets finished calls,
 * `stop` closes the pane.
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
  const view = VIEWS[argument];
  if (view !== undefined) {
    await setView($, view);
  }
  const opened = await reopen($);
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
