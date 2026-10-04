/**
 * What a Bash `tool.call` result means for the call list.
 */
import type { ToolCallResult } from "claude-code";

import type { BashOutcome } from "./calls.ts";

interface BashRecord {
  readonly stdout?: unknown;
  readonly stderr?: unknown;
  readonly interrupted?: unknown;
  readonly backgroundTaskId?: unknown;
}

const textOf = (value: unknown): string =>
  typeof value === "string" ? value : "";

const recordOutcome = (result: unknown, text: string): BashOutcome => {
  const record: BashRecord =
    typeof result === "object" && result !== null ? result : {};
  return {
    isError: false,
    text,
    stdout: textOf(record.stdout),
    stderr: textOf(record.stderr),
    interrupted: record.interrupted === true,
    backgroundTaskId:
      typeof record.backgroundTaskId === "string"
        ? record.backgroundTaskId
        : undefined,
  };
};

// Core reports an interrupted Bash call as an error with this text, not as
// a record with `interrupted: true`.
const ABORTED = /Command was aborted|Interrupted by user/u;

// A command that ran and failed leads with its exit code; any other error
// (a permission rule, a settings hook, the person's refusal, an invalid
// input) means the command never ran.
const RAN = /^Exit code \d+/u;

const refusedOr = (text: string): BashOutcome =>
  RAN.test(text)
    ? { isError: true, text }
    : { isError: false, text, denied: text };

const erroredOutcome = (text: string): BashOutcome =>
  ABORTED.test(text)
    ? { isError: false, text, interrupted: true }
    : refusedOr(text);

const answeredOutcome = (ran: Readonly<ToolCallResult>): BashOutcome =>
  ran.isError === true
    ? erroredOutcome(ran.text ?? "")
    : recordOutcome(ran.result, ran.text ?? "");

/**
 * The outcome of a Bash call from what `next(e)` resolved to.
 * @param ran the chain's answer: denied, errored, or the tool's record
 * @returns the outcome
 */
export const outcomeOf = (ran: Readonly<ToolCallResult>): BashOutcome =>
  ran.deny === undefined
    ? answeredOutcome(ran)
    : { isError: false, text: "", denied: ran.deny };
