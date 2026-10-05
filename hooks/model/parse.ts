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
const TEE = /\|\s*tee\s+(?:-a\s+)?(?:'([^']+)'|"([^"]+)"|([^\s;&|<>'"]+))/u;
const PROMPT = /(?:\s-p|\sexec)\s+(?:'([^']*)'|"([^"]*)"|([^\s;&|<>'"]+))/u;
const PROMPT_WORDS = 6;
const REDIRECT = /(?:^|\s)1?>>?\s*(?:'([^']+)'|"([^"]+)"|([^\s;&|<>'"]+))/u;
const LINE_MAX = 200;
const WATCH_FILE = /--watch-file(?:=|\s+)(?:'([^']*)'|"([^"]*)"|(\S+))/u;
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

const absoluteOf = (
  pattern: Readonly<RegExp>,
  command: string,
): string | undefined => {
  const found = pattern.exec(command);
  const target = found?.[1] ?? found?.[2] ?? found?.[3];
  return target?.startsWith("/") === true ? target : undefined;
};

/**
 * The file whose growth is a runner's output: the guard's `--watch-file`, a
 * runner's `| tee [-a] /path`, or its absolute stdout redirect (`> /path`).
 * @param command the Bash command, as the model wrote it or as wrapped
 * @returns the path, or undefined
 */
export const watchPathOf = (command: string): string | undefined => {
  const found = WATCH_FILE.exec(command);
  const flagged = found?.[1] ?? found?.[2] ?? found?.[3];
  const piped = absoluteOf(TEE, command) ?? absoluteOf(REDIRECT, command);
  return flagged ?? (runnerOf(command) === undefined ? undefined : piped);
};

/**
 * A runner's prompt in its first words (`pi -p '…'`, `codex exec '…'`): its
 * label when the call has no description.
 * @param command the Bash command
 * @returns up to six words, `…` when cut, or undefined without a prompt
 */
export const promptWordsOf = (command: string): string | undefined => {
  const found = PROMPT.exec(command);
  const words = (found?.[1] ?? found?.[2] ?? found?.[3] ?? "")
    .split(/\s+/u)
    .filter((word) => word !== "");
  const more = words.length > PROMPT_WORDS ? "…" : "";
  const head = `${words.slice(0, PROMPT_WORDS).join(" ")}${more}`;
  return words.length === 0 ? undefined : head;
};

/**
 * The runner guard's verdict: the last non-empty line when it is one.
 * @param lines output lines, oldest first
 * @returns `DONE n`, `RATE_LIMIT epoch`, `STALLED reason`, `BUSY pid file`,
 * `WAITING what`, `FAILED why`
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
