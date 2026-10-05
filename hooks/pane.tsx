/**
 * The pane's drawing: reads the calls and the pane's state, and hands the
 * view its button handlers (fold, clear, close, select, stop).
 */
import type { EngineInterface, RenderElement, RenderInput } from "claude-code";
import { atom, read, update } from "claude-code";

import type { ShellAgents, ShellCall } from "../types";
import { finishedIds, liveOnly, noticed, tailed } from "./model/calls.ts";
import { type PaneActions, paneTree } from "./view/pane.tsx";

const NO_CALLS: readonly ShellCall[] = [];
const NO_AGENTS: ShellAgents = {};
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

const agentsAtom = atom(
  { plugin: "agent-shell-watch", key: "agentInfo" } as const,
  NO_AGENTS,
);
const NO_FOLDS: Readonly<Record<string, boolean>> = {};
const foldsAtom = atom(
  { plugin: "agent-shell-watch", key: "folds" } as const,
  NO_FOLDS,
);
const nowAtom = atom({ plugin: "agent-shell-watch", key: "now" } as const, 0);
const openAtom = atom(
  { plugin: "agent-shell-watch", key: "isOpen" } as const,
  false,
);
const selectedAtom = atom(
  { plugin: "agent-shell-watch", key: "selected" } as const,
  "",
);

const PANE = "shell-watch";
const TAIL_LINES = "40";

type Engine = Readonly<EngineInterface>;

// ponytail: the cleared ids list is capped; a transcript keeps 4096 entries.
const CLEARED_MAX = 4096;

const clearCalls = async ($: Readonly<EngineInterface>): Promise<void> => {
  const calls = await read($, callsAtom);
  await update($, clearedAtom, (ids) =>
    [...ids, ...finishedIds(calls)].slice(-CLEARED_MAX),
  );
  await update($, callsAtom, liveOnly);
};

const tailOf = async ($: Engine, path: string): Promise<string | undefined> => {
  try {
    const ran = await $.process.run(["tail", "-n", TAIL_LINES, path]);
    return ran.exitCode === 0 ? ran.stdout : undefined;
  } catch {
    return;
  }
};

const select = async ($: Engine, id: string): Promise<void> => {
  const selected = await update($, selectedAtom, (current) =>
    current === id ? "" : id,
  );
  const calls = await read($, callsAtom);
  const path = calls.find((one) => one.id === id)?.outputPath;
  const text =
    selected === id && path !== undefined ? await tailOf($, path) : undefined;
  if (text === undefined) {
    return;
  }
  await update($, callsAtom, (list) =>
    list.map((one) => (one.id === id ? tailed(one, text) : one)),
  );
};

const stop = async ($: Engine, taskId: string): Promise<void> => {
  const ran = await $.tool.call({ tool: "TaskStop", task_id: taskId });
  if (ran.deny !== undefined || ran.isError === true) {
    return;
  }
  const now = await $.clock.now();
  await update($, callsAtom, (calls) =>
    noticed(calls, [{ taskId, status: "stopped" }], now),
  );
};

const close = async ($: Engine): Promise<void> => {
  await $.store.set("paneOpen", false);
  await update($, openAtom, () => false);
  await $.ui.close({ id: PANE });
};

const setFolds = async (
  $: Engine,
  keys: readonly string[],
  isFolded: boolean,
): Promise<void> => {
  await update($, foldsAtom, (folds) => ({
    ...folds,
    ...Object.fromEntries(keys.map((key) => [key, isFolded])),
  }));
};

const actionsOf = ($: Engine): PaneActions => ({
  clear: () => {
    void clearCalls($);
  },
  close: () => {
    void close($);
  },
  select: (id) => {
    void select($, id);
  },
  stop: (taskId) => {
    void stop($, taskId);
  },
  fold: (key, isFolded) => {
    void setFolds($, [key], isFolded);
  },
  foldAll: (keys, isFolded) => {
    void setFolds($, keys, isFolded);
  },
});

/**
 * `ui.render` of the `agent-shell-watch` pane.
 * @param $ the engine
 * @param e the pane instance to draw
 * @returns the pane's tree
 */
export const onRender = async (
  $: Engine,
  e: Readonly<RenderInput<"Pane">>,
): Promise<RenderElement> => {
  const kit = $.ui.resolve(e);
  const calls = await read($, callsAtom);
  const now = Math.max(await read($, nowAtom), await $.clock.now());
  return paneTree(
    kit,
    {
      calls,
      agents: await read($, agentsAtom),
      folds: await read($, foldsAtom),
      now,
      selected: await read($, selectedAtom),
      columns: e.props.bodyColumns,
      rows: e.props.scroll.bodyRows,
      isFocused: e.props.isFocused,
    },
    actionsOf($),
  );
};
