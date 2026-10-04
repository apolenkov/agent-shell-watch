/**
 * The pane's drawing: reads the calls and the pane's state, and hands the
 * view its button handlers (filter, clear, close, select, stop).
 */
import type { EngineInterface, RenderElement, RenderInput } from "claude-code";
import { atom, read, update } from "claude-code";

import type { ShellAgents, ShellCall } from "../types";
import { liveOnly, noticed, tailed } from "./model/calls.ts";
import { paneTree } from "./view/pane.tsx";

const NO_CALLS: readonly ShellCall[] = [];
const NO_AGENTS: ShellAgents = {};
const callsAtom = atom(
  { plugin: "shell-flow", key: "calls" } as const,
  NO_CALLS,
);
const agentsAtom = atom(
  { plugin: "shell-flow", key: "agents" } as const,
  NO_AGENTS,
);
const nowAtom = atom({ plugin: "shell-flow", key: "now" } as const, 0);
const openAtom = atom({ plugin: "shell-flow", key: "isOpen" } as const, false);
const backgroundOnlyAtom = atom(
  { plugin: "shell-flow", key: "isBackgroundOnly" } as const,
  false,
);
const selectedAtom = atom(
  { plugin: "shell-flow", key: "selected" } as const,
  "",
);

const PANE = "shell-flow";
const TAIL_LINES = "40";

type Engine = Readonly<EngineInterface>;

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

const toggle = async ($: Engine): Promise<void> => {
  const isOn = await update($, backgroundOnlyAtom, (was) => !was);
  await $.store.set("backgroundOnly", isOn);
};

const close = async ($: Engine): Promise<void> => {
  await $.store.set("paneOpen", false);
  await update($, openAtom, () => false);
  await $.ui.close({ id: PANE });
};

/**
 * `ui.render` of the `shell-flow` pane.
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
      now,
      isBackgroundOnly: await read($, backgroundOnlyAtom),
      selected: await read($, selectedAtom),
      columns: e.props.bodyColumns,
    },
    {
      toggle: () => {
        void toggle($);
      },
      clear: () => {
        void update($, callsAtom, liveOnly);
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
    },
  );
};
