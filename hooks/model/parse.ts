/**
 * Pure readers of what a Bash call carries: its input, its result text, the
 * lines of its output, and the engine's background-task notifications.
 */
import type { ShellRunner } from "../../types";
import { shellOf } from "./shell.ts";

const LABEL_MAX = 60;

const OUTPUT_PATH = /Output is being written to: (\S+)/u;
const ASSIGNMENT = /^\w+=/u;
const PROMPT_WORDS = 6;
const LINE_MAX = 200;
const VERDICT =
  /^(?:DONE \d+|RATE_LIMIT \d+|STALLED \S+|BUSY \d+ \S+|WAITING \S.*|FAILED \S.*)$/u;
const EXIT_CODE = /^Exit code (\d+)/u;
const TASK_ID = /<task-id>([^<]+)<\/task-id>/u;
const TASK_STATUS = /<status>([a-z_]+)<\/status>/u;
const TASK_EXIT = /exit code (\d+)/u;

/** What a background task's notification reports. */
export interface TaskNotice {
  readonly taskId: string;
  readonly status: string;
  readonly exitCode?: number;
}

/**
 * The row's label: the tool input's description, else the command's head.
 * @param description the Bash input's `description`
 * @param command the Bash input's `command`
 * @returns a non-empty label when the command is
 */
export const labelOf = (
  description: string | undefined,
  command: string,
): string => {
  const text = description?.trim() ?? "";
  const head = command.replaceAll(/\s+/gu, " ").trim().slice(0, LABEL_MAX);
  return text === "" ? head : text.replaceAll(/\s+/gu, " ");
};

/**
 * The background output file a Bash result's text names.
 * @param text the result as the model reads it
 * @returns the path, or undefined for a foreground result
 */
export const outputPathOf = (text: string): string | undefined =>
  OUTPUT_PATH.exec(text)?.[1]?.replace(/\.$/u, "");

/**
 * The first supported executable runner, including a literal shell script
 * or a recognized guard's child argv. Quoted argument data stays data.
 * @param command the Bash command
 * @returns the runner, or undefined
 */
export const runnerOf = (command: string): ShellRunner | undefined =>
  shellOf(command).runner;

/**
 * The selected runner's absolute stdout/tee file, or a recognized guard's
 * explicit watch path (which may be relative).
 * @param command the Bash command
 * @returns the path, or undefined for unsupported or ambiguous routing
 */
export const watchPathOf = (command: string): string | undefined =>
  shellOf(command).watchPath;

/**
 * A runner's prompt in its first words (`pi -p '…'`, `codex exec '…'`): its
 * label when the call has no description.
 * @param command the Bash command
 * @returns up to six words, `…` when cut, or undefined without a prompt
 */
export const promptWordsOf = (command: string): string | undefined => {
  const words = (shellOf(command).prompt ?? "")
    .split(/\s+/u)
    .filter((word) => word !== "");
  const more = words.length > PROMPT_WORDS ? "…" : "";
  const head = `${words.slice(0, PROMPT_WORDS).join(" ")}${more}`;
  return words.length === 0 ? undefined : head;
};

// Claude Code 2.1.289 ends a background task's output file with this line.
const EXIT_NOTE = /^\[exited with code -?\d+\]$/u;

/**
 * The runner guard's verdict: the last non-empty line when it is one, not
 * counting the `[exited with code n]` line a background task's file ends with.
 * @param lines output lines, oldest first
 * @returns `DONE n`, `RATE_LIMIT epoch`, `STALLED reason`, `BUSY pid file`,
 * `WAITING what`, `FAILED why`
 */
export const verdictOf = (lines: readonly string[]): string | undefined => {
  const last = lines
    .findLast((line) => line.trim() !== "" && !EXIT_NOTE.test(line.trim()))
    ?.trim();
  return last !== undefined && VERDICT.test(last) ? last : undefined;
};

/**
 * The exit code an errored Bash result's text leads with.
 * @param text the result as the model reads it
 * @returns the code, or undefined
 */
export const exitCodeOf = (text: string): number | undefined => {
  const found = EXIT_CODE.exec(text)?.[1];
  return found === undefined ? undefined : Number(found);
};

/**
 * The last `count` lines of a text, each cut to 200 chars, a trailing
 * newline ignored, the `[exited with code n]` line of a background task's
 * file left out: the exit code has its own place, and it is no output.
 * @param text the text
 * @param count how many lines to keep
 * @returns the lines, oldest first
 */
export const lastLines = (text: string, count: number): readonly string[] =>
  text === ""
    ? []
    : text
        .replace(/\n$/u, "")
        .split("\n")
        .filter((line) => !EXIT_NOTE.test(line.trim()))
        .slice(-count)
        .map((line) => line.slice(0, LINE_MAX));

const NOTICE_TAG = "<task-notification>";
const BACKGROUND_ID = /(?:in background with ID: |background \(ID: )([\w-]+)/u;

const notificationOf = (text: string): TaskNotice | undefined => {
  const taskId = TASK_ID.exec(text)?.[1];
  const code = TASK_EXIT.exec(text)?.[1];
  return taskId === undefined
    ? undefined
    : {
        taskId,
        status: TASK_STATUS.exec(text)?.[1] ?? "completed",
        ...(code !== undefined && { exitCode: Number(code) }),
      };
};

/**
 * Every background task's `<task-notification>` among a row's text blocks,
 * several in one block included.
 * @param texts the row's text blocks
 * @returns each notice's task, status and exit code
 */
export const noticesOf = (texts: readonly string[]): readonly TaskNotice[] =>
  texts
    .flatMap((text) => text.split(NOTICE_TAG).slice(1))
    .flatMap((part) => {
      const notice = notificationOf(part);
      return notice === undefined ? [] : [notice];
    });

/**
 * The background task a Bash result's text launched, in either phrasing.
 * @param text the result as the model reads it
 * @returns the task id, or undefined for a foreground result
 */
export const backgroundIdOf = (text: string): string | undefined =>
  BACKGROUND_ID.exec(text)?.[1];

const QUOTED = /'[^']*'|"(?:[^"\\]|\\.)*"/gu;
const SEARCHES: ReadonlySet<string> = new Set([
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  "diff",
  "test",
  "[",
  "[[",
  "cmp",
  "pgrep",
]);

const programOf = (stage: string): readonly string[] => {
  const words = stage.trim().split(/\s+/u);
  const start = words.findIndex((word) => !ASSIGNMENT.test(word));
  return start === -1 ? [] : words.slice(start);
};

/**
 * Whether the command's exit status comes from a search or test tool, whose
 * exit 1 means "no match" (or "differ", "false"), not a failure: the last
 * stage of the last pipeline, quoted text ignored.
 * @param command the Bash command
 * @returns true for grep, rg, ag, ack, git grep, diff, test, [, [[, cmp, pgrep
 */
export const isNoMatchCommand = (command: string): boolean => {
  const bare = command.replaceAll(QUOTED, "Q");
  const last = bare.split(/&&|\|\||;/u).at(-1) ?? "";
  const words = programOf(last.split("|").at(-1) ?? "");
  const name = words[0]?.split("/").at(-1) ?? "";
  return SEARCHES.has(name) || (name === "git" && words[1] === "grep");
};
