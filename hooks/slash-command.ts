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
    await $.ui.close({ id: PANE });
    await update($, openAtom, () => false);
    return { text: "shell-flow closed" };
  }
  if (argument === "clear") {
    await update($, callsAtom, liveOnly);
    await update($, selectedAtom, () => "");
    return { text: "shell-flow: finished calls cleared" };
  }
  const { columns } = await read($, configAtom);
  const opened = await $.ui.open({
    id: PANE,
    title: "shell",
    columns,
    focus: true,
  });
  await update($, openAtom, () => true);
  return {
    text: opened.isPlaced
      ? "shell-flow opened · /shell-flow stop closes"
      : "shell-flow: the pane waits for room",
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
  if (e.id === PANE) {
    await update($, openAtom, () => false);
  }
  return next(e);
};
