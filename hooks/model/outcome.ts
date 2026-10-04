/**
 * What a Bash `tool.call` result means for the call list.
 */
import type { BashOutcome } from "./calls.ts";
import { backgroundIdOf } from "./parse.ts";

interface BashRecord {
  readonly stdout?: unknown;
  readonly stderr?: unknown;
  readonly interrupted?: unknown;
  readonly backgroundTaskId?: unknown;
}

const textOf = (value: unknown): string =>
  typeof value === "string" ? value : "";

// A transcript answer may carry only `text` (a subagent's rows, a headless
// record): the text is then the output, and names a background launch.
const textRecord = (text: string): BashRecord => ({
  stdout: text,
  backgroundTaskId: backgroundIdOf(text),
});

const recordOutcome = (result: unknown, text: string): BashOutcome => {
  const record: BashRecord =
    typeof result === "object" && result !== null ? result : textRecord(text);
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

/** What `next(e)` resolved to, or a transcript's tool use, as read here. */
export interface BashAnswer {
  readonly deny?: string | undefined;
  readonly isError?: boolean | undefined;
  readonly result?: unknown;
  readonly text?: string | undefined;
}

const answeredOutcome = (ran: BashAnswer): BashOutcome =>
  ran.isError === true
    ? erroredOutcome(ran.text ?? "")
    : recordOutcome(ran.result, ran.text ?? "");

/**
 * The outcome of a Bash call from what `next(e)` resolved to.
 * @param ran the chain's answer: denied, errored, or the tool's record
 * @returns the outcome
 */
export const outcomeOf = (ran: BashAnswer): BashOutcome =>
  ran.deny === undefined
    ? answeredOutcome(ran)
    : { isError: false, text: "", denied: ran.deny };
