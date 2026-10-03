/**
 * Pure readers of what a Bash call carries: its input, its result text, the
 * lines of its output, and the engine's background-task notifications.
 */
import type { ShellRunner } from "../../types";

const LABEL_MAX = 60;

const OUTPUT_PATH = /Output is being written to: (\S+)/u;
const RUNNERS: ReadonlySet<string> = new Set(["codex", "pi", "devin", "ocr"]);
const SEGMENT = /[;&|()]|\s--\s/u;
const ASSIGNMENT = /^\w+=/u;
const SHELL_C = /(?:^|\s)(?:ba|z)?sh\s+-l?c\s+['"]?/gu;
const REDIRECT = /(?:^|\s)1?>>?\s*(?:'([^']+)'|"([^"]+)"|([^\s;&|<>'"]+))/u;
const LINE_MAX = 200;
const WATCH_FILE = /--watch-file(?:=|\s+)(?:'([^']*)'|"([^"]*)"|(\S+))/u;
const VERDICT = /^(?:DONE \d+|RATE_LIMIT \d+|STALLED \S+|BUSY \d+ \S+)$/u;
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
  return text === "" ? command.trim().slice(0, LABEL_MAX) : text;
};

/**
 * The background output file a Bash result's text names.
 * @param text the result as the model reads it
 * @returns the path, or undefined for a foreground result
 */
export const outputPathOf = (text: string): string | undefined =>
  OUTPUT_PATH.exec(text)?.[1]?.replace(/\.$/u, "");

/**
 * The external agent CLI a command segment runs as its executable: the
 * first word past `NAME=value` assignments, after `;`, `&&`, `|`, a guard's
 * ` -- `, or inside a `bash -c '…'` / `sh -c "…"` wrapper.
 * @param command the Bash command
 * @returns the runner, or undefined
 */
export const runnerOf = (command: string): ShellRunner | undefined =>
  command
    .replaceAll(SHELL_C, " ; ")
    .split(SEGMENT)
    .map(
      (part) =>
        part
          .trim()
          .split(/\s+/u)
          .find((word) => !ASSIGNMENT.test(word))
          ?.split("/")
          .at(-1) ?? "",
    )
    .find((name) => RUNNERS.has(name)) as ShellRunner | undefined;

const redirectOf = (command: string): string | undefined => {
  const found = REDIRECT.exec(command);
  const target = found?.[1] ?? found?.[2] ?? found?.[3];
  return target?.startsWith("/") === true ? target : undefined;
};

/**
 * The file whose growth is a runner's output: the guard's `--watch-file`, or
 * a runner's absolute stdout redirect (`> /path`, what the guard would watch).
 * @param command the Bash command, as the model wrote it or as wrapped
 * @returns the path, or undefined
 */
export const watchPathOf = (command: string): string | undefined => {
  const found = WATCH_FILE.exec(command);
  const flagged = found?.[1] ?? found?.[2] ?? found?.[3];
  return (
    flagged ??
    (runnerOf(command) === undefined ? undefined : redirectOf(command))
  );
};

/**
 * The runner guard's verdict: the last non-empty line when it is one.
 * @param lines output lines, oldest first
 * @returns `DONE n`, `RATE_LIMIT epoch`, `STALLED reason`, `BUSY pid file`
 */
export const verdictOf = (lines: readonly string[]): string | undefined => {
  const last = lines.findLast((line) => line.trim() !== "")?.trim();
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
 * newline ignored.
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
        .slice(-count)
        .map((line) => line.slice(0, LINE_MAX));

const notificationOf = (text: string): TaskNotice | undefined => {
  const taskId = TASK_ID.exec(text)?.[1];
  const code = TASK_EXIT.exec(text)?.[1];
  return taskId === undefined || !text.includes("<task-notification>")
    ? undefined
    : {
        taskId,
        status: TASK_STATUS.exec(text)?.[1] ?? "completed",
        ...(code !== undefined && { exitCode: Number(code) }),
      };
};

/**
 * The background tasks' `<task-notification>`s among a row's text blocks.
 * @param texts the row's text blocks
 * @returns each notice's task, status and exit code
 */
export const noticesOf = (texts: readonly string[]): readonly TaskNotice[] =>
  texts.flatMap((text) => {
    const notice = notificationOf(text);
    return notice === undefined ? [] : [notice];
  });

/** What `$.agent.list()` says of one subagent. */
export interface AgentEntry {
  readonly id: string;
  readonly type: string;
  readonly description: string;
}

/**
 * A subagent's label: `type: description`, else `agent <id>`.
 * @param agents the session's subagents
 * @param id the subagent's id
 * @returns the label
 */
export const agentLabelOf = (
  agents: readonly AgentEntry[],
  id: string,
): string => {
  const found = agents.find((agent) => agent.id === id);
  return found === undefined
    ? `agent ${id}`
    : `${found.type}: ${found.description}`;
};
