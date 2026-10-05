/**
 * Records Bash calls as they start and settle, names the subagents that make
 * them, and settles background runs when their notification arrives. The
 * status line follows within a second, from the poller's tick.
 */
import type {
  EngineInterface,
  Next,
  SessionAppendInput,
  SessionAppendResult,
  ToolCallInput,
  ToolCallResult,
} from "claude-code";
import { atom, read, update } from "claude-code";

import type { ShellAgents, ShellCall } from "../types";
import { noticed, settled, started, trimmed } from "./model/calls.ts";
import { configOf } from "./model/config.ts";
import { agentTableOf } from "./model/groups.ts";
import { outcomeOf } from "./model/outcome.ts";
import { noticesOf } from "./model/parse.ts";

const NO_CALLS: readonly ShellCall[] = [];
const NO_AGENTS: ShellAgents = {};
const agentsAtom = atom(
  { plugin: "agent-shell-watch", key: "agentInfo" } as const,
  NO_AGENTS,
);
const callsAtom = atom(
  { plugin: "agent-shell-watch", key: "calls" } as const,
  NO_CALLS,
);
const configAtom = atom(
  { plugin: "agent-shell-watch", key: "config" } as const,
  configOf({}),
);

const nameAgent = async (
  $: Readonly<EngineInterface>,
  agentId: string,
): Promise<void> => {
  const known = await read($, agentsAtom);
  if (known[agentId] !== undefined) {
    return;
  }
  try {
    const listed = agentTableOf(await $.agent.list());
    await update($, agentsAtom, (agents) => ({ ...agents, ...listed }));
  } catch {
    // Unnamed: the pane falls back to `agent <id>`.
  }
};

// A TaskStop the model makes ends its task without a <task-notification>.
const stopTask = async (
  $: Readonly<EngineInterface>,
  e: Readonly<Extract<ToolCallInput, { tool: "TaskStop" }>>,
  next: Next<"tool.call">,
): Promise<ToolCallResult> => {
  const stopped = await next(e);
  const taskId = e.task_id ?? e.shell_id;
  const isStopped = stopped.deny === undefined && stopped.isError !== true;
  if (isStopped && taskId !== undefined) {
    const now = await $.clock.now();
    await update($, callsAtom, (calls) =>
      noticed(calls, [{ taskId, status: "stopped" }], now),
    );
  }
  return stopped;
};

/**
 * `tool.call`: a Bash call is recorded, run, and its result recorded; a
 * successful TaskStop settles its call; every result is passed on unchanged.
 * @param $ the engine
 * @param e the call
 * @param next the rest of the chain
 * @returns what the chain answered
 */
export const onToolCall = async (
  $: Readonly<EngineInterface>,
  e: Readonly<ToolCallInput>,
  next: Next<"tool.call">,
): Promise<ToolCallResult> => {
  if (e.tool === "TaskStop") {
    return stopTask($, e, next);
  }
  if (e.tool !== "Bash") {
    return next(e);
  }
  const { maxCalls } = await read($, configAtom);
  const call = started(
    {
      tool_use_id: e.tool_use_id,
      command: e.command,
      description: e.description,
      agentId: e.agentId,
    },
    await $.clock.now(),
  );
  await update($, callsAtom, (calls) => trimmed([...calls, call], maxCalls));
  if (e.agentId !== undefined) {
    await nameAgent($, e.agentId);
  }
  const ran = await next(e);
  const now = await $.clock.now();
  await update($, callsAtom, (calls) =>
    calls.map((one) =>
      one.id === call.id ? settled(one, outcomeOf(ran), now) : one,
    ),
  );
  return ran;
};

/**
 * `session.append`: a `<task-notification>` row settles its background call.
 * @param $ the engine
 * @param e the row
 * @param next the rest of the chain
 * @returns the row as stored
 */
export const onAppend = async (
  $: Readonly<EngineInterface>,
  e: Readonly<SessionAppendInput>,
  next: Next<"session.append">,
): Promise<SessionAppendResult> => {
  const notices = noticesOf(
    e.message.content
      .filter((block) => block.type === "text")
      .map((block) => String(block["text"])),
  );
  if (notices.length > 0) {
    const now = await $.clock.now();
    await update($, callsAtom, (calls) => noticed(calls, notices, now));
  }
  return next(e);
};
