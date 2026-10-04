/**
 * `/shell-flow` (`clear`, `stop`) and the pane's closing by the person.
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

import type { ShellCall } from "../types";
import { liveOnly } from "./model/calls.ts";
import { configOf } from "./model/config.ts";

const NO_CALLS: readonly ShellCall[] = [];
const callsAtom = atom(
  { plugin: "shell-flow", key: "calls" } as const,
  NO_CALLS,
);
const configAtom = atom(
  { plugin: "shell-flow", key: "config" } as const,
  configOf({}),
);
const openAtom = atom({ plugin: "shell-flow", key: "isOpen" } as const, false);
const selectedAtom = atom(
  { plugin: "shell-flow", key: "selected" } as const,
  "",
);

/** The pane's id and the command's name. */
export const PANE = "shell-flow";

/**
 * `command.run` for `/shell-flow`: opens the pane, `clear` forgets finished
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
    await update($, callsAtom, liveOnly);
    await update($, selectedAtom, () => "");
    return { text: "finished calls cleared" };
  }
  const { columns } = await read($, configAtom);
  const opened = await $.ui.open({
    id: PANE,
    title: "shell",
    columns,
    focus: true,
  });
  await update($, openAtom, () => true);
  await $.store.set("paneOpen", true);
  return {
    text: opened.isPlaced
      ? "keys on the pane · Esc → prompt · /shell-flow again refocuses"
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
