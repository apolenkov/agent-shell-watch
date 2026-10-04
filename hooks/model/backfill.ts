/**
 * Bash calls rebuilt from the transcript, for calls made before the mod
 * loaded (enabled mid-session, a hot reload, an update).
 */
import type { ShellCall } from "../../types";
import { noticed, settled, started, trimmed } from "./calls.ts";
import { outcomeOf } from "./outcome.ts";
import { noticesOf } from "./parse.ts";

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
  const calls = rows
    .flatMap((row) => row.toolUses)
    .filter((use) => use.tool === "Bash" && isAnswered(use))
    .map((use) => callOf(use, agentId, now));
  return noticed(calls, noticesOf(rows.map((row) => row.text)), now);
};

/**
 * The state's calls with the rebuilt ones it lacks added before them, cut to
 * `max` (the oldest finished dropped first). The state's own copy wins.
 * @param known the calls in state
 * @param rebuilt the calls rebuilt from the transcript
 * @param max how many to keep
 * @returns the list
 */
export const merged = (
  known: readonly ShellCall[],
  rebuilt: readonly ShellCall[],
  max: number,
): readonly ShellCall[] => {
  const ids = new Set(known.map((call) => call.id));
  const added = rebuilt.filter((call) => !ids.has(call.id));
  return trimmed([...added, ...known], max);
};
