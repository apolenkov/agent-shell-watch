/**
 * Bash calls rebuilt from the transcript, for calls made before the mod
 * loaded (enabled mid-session, a hot reload, an update).
 */
import type { ShellCall } from "../../types";
import { noticed, settled, started, trimmed } from "./calls.ts";
import { outcomeOf } from "./outcome.ts";
import { noticesOf, type TaskNotice } from "./parse.ts";

/** One tool use as `$.session.messages()` reports it. */
export interface ToolUseRow {
  readonly tool_use_id: string;
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
  readonly text?: string;
  readonly isError?: true;
  readonly durationMs?: number;
}

/** One transcript message as `$.session.messages()` reports it. */
export interface MessageRow {
  readonly text: string;
  readonly toolUses: readonly ToolUseRow[];
}

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

// A TaskStop the model made ends its task without a <task-notification>.
const stopsOf = (uses: readonly ToolUseRow[]): readonly TaskNotice[] =>
  uses
    .filter((use) => use.tool === "TaskStop" && use.isError !== true)
    .map(
      (use) =>
        stringOf(use.input["task_id"]) ?? stringOf(use.input["shell_id"]),
    )
    .filter((taskId) => taskId !== undefined)
    .map((taskId) => ({ taskId, status: "stopped" }));

const isAnswered = (use: ToolUseRow): boolean =>
  use.result !== undefined || use.text !== undefined;

const callOf = (
  use: ToolUseRow,
  agentId: string | undefined,
  now: number,
): ShellCall => {
  const call = started(
    {
      tool_use_id: use.tool_use_id,
      command: stringOf(use.input["command"]) ?? "",
      description: stringOf(use.input["description"]),
      agentId,
    },
    now - (use.durationMs ?? 0),
  );
  const answer =
    use.isError === true
      ? { isError: true as const, result: use.result, text: use.text ?? "" }
      : { result: use.result, text: use.text ?? "" };
  return settled(call, outcomeOf(answer), now);
};

/**
 * The answered Bash calls of one conversation, each settled from its result;
 * a background call stays running unless a task notification ended it. An
 * unanswered foreground call is left out: nothing would ever settle it.
 * @param rows the conversation's messages
 * @param agentId the subagent's id, undefined for the main loop
 * @param now the clock's time (no timestamps: elapsed counts from here)
 * @returns the calls, transcript order
 */
export const backfilled = (
  rows: readonly MessageRow[],
  agentId: string | undefined,
  now: number,
): readonly ShellCall[] => {
  const uses = rows.flatMap((row) => row.toolUses);
  const calls = uses
    .filter((use) => use.tool === "Bash" && isAnswered(use))
    .map((use) => callOf(use, agentId, now));
  return noticed(
    calls,
    [...noticesOf(rows.map((row) => row.text)), ...stopsOf(uses)],
    now,
  );
};

/** How many calls to keep, and which ids never to bring back. */
export interface Keep {
  readonly max: number;
  readonly cleared: readonly string[];
}

/**
 * The state's calls and the rebuilt ones it lacks, in transcript order (the
 * state's own copy wins, calls only the state knows follow), without the
 * ones the person cleared, cut to `max` (the oldest finished dropped first).
 * @param known the calls in state
 * @param rebuilt the calls rebuilt from the transcript, oldest first
 * @param keep how many to keep (`max`) and the ids the person cleared
 * @returns the list
 */
export const merged = (
  known: readonly ShellCall[],
  rebuilt: readonly ShellCall[],
  keep: Keep,
): readonly ShellCall[] => {
  const { max, cleared } = keep;
  const gone = new Set(cleared);
  const byId = new Map(known.map((call) => [call.id, call]));
  const rebuiltIds = new Set(rebuilt.map((call) => call.id));
  const ordered = [
    ...rebuilt
      .filter((call) => !gone.has(call.id))
      .map((call) => byId.get(call.id) ?? call),
    ...known.filter((call) => !rebuiltIds.has(call.id)),
  ];
  return trimmed(ordered, max);
};
