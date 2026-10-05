/**
 * agent-shell-watch: an always-on status line and a pane for this session's Bash
 * calls, background tasks and runner (Codex, Pi, Devin, OpenCodeReview) runs.
 * Every hook observes and passes its event on unchanged. The poller lives
 * here: the engine follows `$` only into functions of the same file.
 */
import type { AgentInfo, EngineInterface, Register } from "claude-code";
import { atom, read, update } from "claude-code";

import type { ShellAgents, ShellCall, ShellView } from "../types";
import { onLimitsStart } from "./limits.ts";
import { backfilled, merged, type MessageRow } from "./model/backfill.ts";
import { classified, hasLive, polled, tailed } from "./model/calls.ts";
import { type Config, configOf } from "./model/config.ts";
import { statusLineOf } from "./model/format.ts";
import { agentTableOf } from "./model/groups.ts";
import { blockedOf, NO_LIMITS } from "./model/limits.ts";
import { rowsWantedFor } from "./model/pane-items.ts";
import { isTailDue, tailPathOf, watchedOf } from "./model/poll.ts";
import { onRender } from "./pane.tsx";
import { onClose, onCommand, PANE } from "./slash-command.ts";
import { onAppend, onToolCall } from "./track.ts";

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

const configAtom = atom(
  { plugin: "agent-shell-watch", key: "config" } as const,
  configOf({}),
);
const nowAtom = atom({ plugin: "agent-shell-watch", key: "now" } as const, 0);
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
const limitsAtom = atom(
  { plugin: "agent-shell-watch", key: "limits" } as const,
  NO_LIMITS,
);
const openAtom = atom(
  { plugin: "agent-shell-watch", key: "isOpen" } as const,
  false,
);

const TICK_MS = 1000;
const POLL_MS = 2000;
const TAIL_LINES = "40";

type Engine = Readonly<EngineInterface>;

// undefined when the list fails, so the last snapshot stays.
const agentsOf = async (
  $: Engine,
): Promise<readonly AgentInfo[] | undefined> => {
  try {
    return await $.agent.list();
  } catch {
    return;
  }
};

// The list's entries win: they carry the agents' fresh status.
const refreshAgents = async (
  $: Engine,
  listed: readonly AgentInfo[] | undefined,
): Promise<void> => {
  if (listed === undefined) {
    return;
  }
  const table = agentTableOf(listed);
  await update($, agentsAtom, (known) => ({ ...known, ...table }));
};

const tick = async ($: Engine, config: Config): Promise<void> => {
  const now = await $.clock.now();
  const calls = await read($, callsAtom);
  if (hasLive(calls)) {
    await update($, nowAtom, () => now);
  }
  const status = statusLineOf(calls, now, {
    agents: await read($, agentsAtom),
    blocked: blockedOf(await read($, limitsAtom), now),
  });
  $.ui.status(config.statusLine ? status : undefined);
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
  // Subagents' statuses feed their groups' rollups.
  if (calls.some((call) => call.agentId !== undefined)) {
    await refreshAgents($, await agentsOf($));
  }
  // The status line shows what this poll found, not only the next tick.
  await tick($, config);
};

// The person's last choice outlives the session in $.store; openOnStart is
// the default until they have made one.
const restore = async ($: Engine, config: Config): Promise<void> => {
  const view = await $.store.get("view");
  if (view === "agents" || view === "runners") {
    await update($, viewAtom, () => view);
  }
  const stored = await $.store.get("paneOpen");
  const isOpen = typeof stored === "boolean" ? stored : config.openOnStart;
  if (!isOpen) {
    return;
  }
  await $.ui.open({
    id: PANE,
    title: "shell-watch",
    columns: config.columns,
    rows: rowsWantedFor({
      view: await read($, viewAtom),
      calls: await read($, callsAtom),
      agents: await read($, agentsAtom),
      folds: await read($, foldsAtom),
      now: await $.clock.now(),
    }),
  });
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

// Calls made before the mod loaded (enabled mid-session, a reload, an
// update): rebuilt from the main transcript and each running agent's.
const backfill = async ($: Engine, config: Config): Promise<void> => {
  const now = await $.clock.now();
  const listed = await agentsOf($);
  await refreshAgents($, listed);
  const agents = (listed ?? []).filter((agent) => agent.status === "running");
  const main = backfilled(await rowsOf($), undefined, now);
  const subs = await Promise.all(
    agents.map(async (agent) =>
      backfilled(await rowsOf($, agent.id), agent.id, now),
    ),
  );
  const cleared = await read($, clearedAtom);
  await update($, callsAtom, (calls) =>
    merged(calls, [...main, ...subs.flat()], {
      max: config.maxCalls,
      cleared,
    }),
  );
};

/**
 * Wires agent-shell-watch's hooks.
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
        "Live Bash calls, background tasks and runner runs (runners|agents|clear|stop)",
      argumentHint: "[runners|agents|clear|stop]",
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
  on("session.start", { isInteractive: true }, onLimitsStart);
  on("tool.call", onToolCall);
  on("session.append", onAppend);
  on("command.run", { command: "shell-watch" }, onCommand);
  on("ui.close", onClose);
  // Opening the pane (the command, a restore) picks up what was missed.
  on("ui.open", async ($, e, next) => {
    if (e.id === PANE) {
      await backfill($, config);
    }
    return next(e);
  });
  on("ui.render", { component: "Pane", requestId: "shell-watch" }, onRender);
};
