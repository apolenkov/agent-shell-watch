/**
 * The runners view's list: only the calls an external agent CLI made, flat,
 * each with the agent that started it.
 */
import type { ShellCall } from "../../types";
import { urgencyOrder } from "./calls.ts";
import { type AgentTable, groupLabelOf } from "./groups.ts";

/** One runner call and who started it (`main` or an agent's label). */
export interface Runner {
  readonly call: ShellCall;
  readonly by: string;
}

/**
 * The runner calls, most urgent first (the order of `urgencyOrder`), each
 * with the label of the agent whose Bash call it was.
 * @param calls the list
 * @param agents the known agents
 * @returns the runners
 */
export const runnersOf = (
  calls: readonly ShellCall[],
  agents: AgentTable,
): readonly Runner[] =>
  urgencyOrder(calls.filter((call) => call.runner !== undefined)).map(
    (call) => ({ call, by: groupLabelOf(call.agentId ?? "main", agents) }),
  );
