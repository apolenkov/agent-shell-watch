/**
 * shell-flow: an always-on status line and a pane for this session's Bash
 * calls, background tasks and runner (Codex, Pi, Devin, OpenCodeReview) runs.
 * Every hook observes and passes its event on unchanged. The poller lives
 * here: the engine follows `$` only into functions of the same file.
 */
import type { AgentInfo, EngineInterface, Register } from "claude-code";
import { atom, read, update } from "claude-code";

import type { ShellAgents, ShellCall } from "../types";
import { backfilled, merged, type MessageRow } from "./model/backfill.ts";
import { classified, hasLive, polled, tailed } from "./model/calls.ts";
import { type Config, configOf } from "./model/config.ts";
import { statusLineOf } from "./model/format.ts";
import { agentLabelOf } from "./model/parse.ts";
import { isTailDue, tailPathOf, watchedOf } from "./model/poll.ts";
import { onRender } from "./pane.tsx";
import { onClose, onCommand, PANE } from "./slash-command.ts";
import { onAppend, onToolCall } from "./track.ts";

const NO_CALLS: readonly ShellCall[] = [];
const NO_AGENTS: ShellAgents = {};
const callsAtom = atom(
  { plugin: "shell-flow", key: "calls" } as const,
  NO_CALLS,
);
const NO_IDS: readonly string[] = [];
// The ids `clear` forgot, so a backfill does not bring them back.
const clearedAtom = atom(
  { plugin: "shell-flow", key: "cleared" } as const,
  NO_IDS,
);

const configAtom = atom(
  { plugin: "shell-flow", key: "config" } as const,
  configOf({}),
);
const nowAtom = atom({ plugin: "shell-flow", key: "now" } as const, 0);
const agentsAtom = atom(
  { plugin: "shell-flow", key: "agents" } as const,
  NO_AGENTS,
);
const openAtom = atom({ plugin: "shell-flow", key: "isOpen" } as const, false);

const TICK_MS = 1000;
const POLL_MS = 2000;
const TAIL_LINES = "40";

type Engine = Readonly<EngineInterface>;

const tick = async ($: Engine, config: Config): Promise<void> => {
  const now = await $.clock.now();
  const calls = await read($, callsAtom);
  if (hasLive(calls)) {
    await update($, nowAtom, () => now);
  }
  $.ui.status(config.statusLine ? statusLineOf(calls, now) : undefined);
};

const tailOf = async ($: Engine, path: string): Promise<string | undefined> => {
  try {
    const ran = await $.process.run(["tail", "-n", TAIL_LINES, path]);
    return ran.exitCode === 0 ? ran.stdout : undefined;
  } catch {
    return;
  }
};

const statOf = async (
  $: Engine,
  path: string,
): Promise<{ size: number; mtimeMs: number } | undefined> => {
  try {
    return await $.fs.stat(path);
  } catch {
    // A runner's watch file may not exist yet: silence, not failure.
    return;
  }
};

const pollCall = async (
  $: Engine,
  call: ShellCall,
  isTailWanted: boolean,
): Promise<void> => {
  const stat = await statOf($, call.watchPath ?? call.outputPath ?? "");
  const isNew = stat !== undefined && stat.size !== call.outputBytes;
  const text = isTailDue(call, { isNew, isWanted: isTailWanted })
    ? await tailOf($, tailPathOf(call) ?? "")
    : undefined;
  const now = await $.clock.now();
  await update($, callsAtom, (calls) =>
    calls.map((one) => {
      const fresh =
        stat !== undefined && one.id === call.id ? polled(one, stat, now) : one;
      return text !== undefined && one.id === call.id
        ? tailed(fresh, text)
        : fresh;
    }),
  );
};

const poll = async ($: Engine, config: Config): Promise<void> => {
  // Live rows are always drawn, so an open pane keeps each one's tail fresh.
  const isOpen = await read($, openAtom);
  const calls = await read($, callsAtom);
  const watched = watchedOf(calls);
  await Promise.all(
    watched.map(async (call) =>
      pollCall($, call, call.runner !== undefined || isOpen),
    ),
  );
  const now = await $.clock.now();
  await update($, callsAtom, (calls) =>
    calls.map((call) => classified(call, now, config.limits)),
  );
  // The status line shows what this poll found, not only the next tick.
  await tick($, config);
};

// The person's last choice outlives the session in $.store; openOnStart is
// the default until they have made one.
const restore = async ($: Engine, config: Config): Promise<void> => {
  const stored = await $.store.get("paneOpen");
  const isOpen = typeof stored === "boolean" ? stored : config.openOnStart;
  if (!isOpen) {
    return;
  }
  await $.ui.open({ id: PANE, title: "shell", columns: config.columns });
  await update($, openAtom, () => true);
};

const rowsOf = async (
  $: Engine,
  agentId?: string,
): Promise<readonly MessageRow[]> => {
  try {
    const rows =
      agentId === undefined
        ? await $.session.messages()
        : await $.session.messages({ agentId });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
};

const agentsOf = async ($: Engine): Promise<readonly AgentInfo[]> => {
  try {
    return await $.agent.list();
  } catch {
    return [];
  }
};

// Calls made before the mod loaded (enabled mid-session, a reload, an
// update): rebuilt from the main transcript and each running agent's.
const backfill = async ($: Engine, config: Config): Promise<void> => {
  const now = await $.clock.now();
  const listed = await agentsOf($);
  const agents = listed.filter((agent) => agent.status === "running");
  const main = backfilled(await rowsOf($), undefined, now);
  const subs = await Promise.all(
    agents.map(async (agent) =>
      backfilled(await rowsOf($, agent.id), agent.id, now),
    ),
  );
  await update($, agentsAtom, (known) => ({
    ...Object.fromEntries(
      agents.map((agent) => [agent.id, agentLabelOf(agents, agent.id)]),
    ),
    ...known,
  }));
  const cleared = await read($, clearedAtom);
  await update($, callsAtom, (calls) =>
    merged(calls, [...main, ...subs.flat()], {
      max: config.maxCalls,
      cleared,
    }),
  );
};

/**
 * Wires shell-flow's hooks.
 * @param on the registrar
 * @param options the `userConfig` values
 */
export const register: Register = (on, options) => {
  const config = configOf(options);
  // session.start fires again on a hot reload, which dropped the timers:
  // the poller restarts here and picks up the calls the state still holds.
  on("session.start", async ($, e, next) => {
    const started = await next(e);
    await update($, configAtom, () => config);
    await $.command.register({
      name: PANE,
      description:
        "Live Bash calls, background tasks and runner runs (clear|stop)",
      argumentHint: "[clear|stop]",
      immediate: true,
    });
    $.clock.every(TICK_MS, () => {
      void tick($, config);
    });
    $.clock.every(POLL_MS, () => {
      void poll($, config);
    });
    await backfill($, config);
    await restore($, config);
    return started;
  });
  on("tool.call", onToolCall);
  on("session.append", onAppend);
  on("command.run", { command: "shell-flow" }, onCommand);
  on("ui.close", onClose);
  // Opening the pane (the command, a restore) picks up what was missed.
  on("ui.open", async ($, e, next) => {
    if (e.id === PANE) {
      await backfill($, config);
    }
    return next(e);
  });
  on("ui.render", { component: "Pane", requestId: "shell-flow" }, onRender);
};
