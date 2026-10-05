/**
 * Calls grouped by the agent that made them: the main loop, each subagent.
 * A group's rollup status sorts the most urgent group first.
 */
import type { ShellAgentInfo, ShellCall, ShellStatus } from "../../types";
import { isLive } from "./calls.ts";
import { paneOrder } from "./layout.ts";

/** A group's status: a call's, or `idle` for a running agent at rest. */
export type GroupStatus = ShellStatus | "idle";

/** The calls of one agent and how the group stands. */
export interface Group {
  readonly key: string;
  readonly label: string;
  readonly calls: readonly ShellCall[];
  readonly status: GroupStatus;
  readonly live: number;
}

/** Agents by id, as the state keeps them. */
export type AgentTable = Readonly<Record<string, ShellAgentInfo>>;

/** Group keys mapped to the person's fold choices (true: folded). */
export type Folds = Readonly<Record<string, boolean>>;

const MAIN = "main";
// The main loop is always there: it counts as an agent that is running, so
// its old failures read idle rather than failed for ever.
const MAIN_AGENT: ShellAgentInfo = {
  type: MAIN,
  description: "",
  status: "running",
};
const RECENT_FAILURE_MS = 120_000;
const RANK: Readonly<Record<GroupStatus, number>> = {
  hung: 0,
  failed: 1,
  quiet: 2,
  running: 3,
  idle: 4,
  stopped: 5,
  done: 6,
  nomatch: 6,
  denied: 7,
};
const OPEN_BY_DEFAULT: ReadonlySet<GroupStatus> = new Set([
  "hung",
  "failed",
  "quiet",
  "running",
  "idle",
]);
// An agent's own status, where it decides the group's.
const BY_AGENT: Readonly<Partial<Record<string, GroupStatus>>> = {
  failed: "failed",
  killed: "failed",
  running: "idle",
};

const ownLabelOf = (key: string, agents: AgentTable): string => {
  const agent = agents[key];
  return agent === undefined
    ? `agent ${key}`
    : `${agent.type}: ${agent.description}`;
};

/**
 * A group's label: `main`, the agent's `type: description` (`agent <id>`
 * when unknown), and for a nested agent ` ↳ <parent's label>`.
 * @param key the group's key
 * @param agents the known agents
 * @returns the label
 */
export const groupLabelOf = (key: string, agents: AgentTable): string => {
  const parent = agents[key]?.parentId;
  const nested = parent === undefined ? "" : ` ↳ ${ownLabelOf(parent, agents)}`;
  return key === MAIN ? MAIN : ownLabelOf(key, agents) + nested;
};

const worstOf = (statuses: readonly GroupStatus[]): GroupStatus | undefined =>
  statuses.toSorted((a, b) => RANK[a] - RANK[b])[0];

const settledOf = (
  calls: readonly ShellCall[],
  agent: ShellAgentInfo | undefined,
  now: number,
): GroupStatus => {
  const isRecentFailure = calls.some(
    (call) =>
      call.status === "failed" &&
      now - (call.endedAt ?? now) < RECENT_FAILURE_MS,
  );
  const byAgent = BY_AGENT[agent?.status ?? ""];
  const settled = calls
    .map((call) => call.status)
    .filter((status) => status !== "failed");
  return isRecentFailure ? "failed" : (byAgent ?? worstOf(settled) ?? "done");
};

const groupOf = (
  key: string,
  calls: readonly ShellCall[],
  context: Readonly<{ agents: AgentTable; now: number }>,
): Group => {
  const live = calls.filter(isLive);
  return {
    key,
    label: groupLabelOf(key, context.agents),
    calls: paneOrder(calls),
    status:
      worstOf(live.map((call) => call.status)) ??
      settledOf(
        calls,
        key === MAIN ? MAIN_AGENT : context.agents[key],
        context.now,
      ),
    live: live.length,
  };
};

const newestOf = (group: Group): number =>
  Math.max(...group.calls.map((call) => call.startedAt));

/**
 * The calls grouped by agent (`agentId`, else `main`), the most urgent group
 * first (hung, failed, quiet, running, idle, then settled), then the newest.
 * @param calls the list
 * @param agents the known agents
 * @param now the clock's time
 * @returns the groups, each with its calls in pane order
 */
export const groupsOf = (
  calls: readonly ShellCall[],
  agents: AgentTable,
  now: number,
): readonly Group[] => {
  const keys = [...new Set(calls.map((call) => call.agentId ?? MAIN))];
  return keys
    .map((key) =>
      groupOf(
        key,
        calls.filter((call) => (call.agentId ?? MAIN) === key),
        { agents, now },
      ),
    )
    .toSorted(
      (a, b) => RANK[a.status] - RANK[b.status] || newestOf(b) - newestOf(a),
    );
};

/**
 * Whether a group is folded: the person's choice, else folded once nothing
 * in it is live, failed or idle.
 * @param group the group
 * @param folds the person's choices
 * @returns true when folded
 */
export const isFolded = (group: Group, folds: Folds): boolean =>
  folds[group.key] ?? !OPEN_BY_DEFAULT.has(group.status);

/** What `$.agent.list()` says of one agent, as far as groups need it. */
export interface ListedAgent {
  readonly id: string;
  readonly type: string;
  readonly description: string;
  readonly status: string;
  readonly parentId?: string | undefined;
}

/**
 * The agent table from `$.agent.list()`.
 * @param listed the session's agents
 * @returns their type, description, status and parent by id
 */
export const agentTableOf = (listed: readonly ListedAgent[]): AgentTable =>
  Object.fromEntries(
    listed.map((agent) => [
      agent.id,
      {
        type: agent.type,
        description: agent.description,
        status: agent.status,
        ...(agent.parentId !== undefined && { parentId: agent.parentId }),
      },
    ]),
  );
