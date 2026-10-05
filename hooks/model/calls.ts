/**
 * Pure transitions of the call list: a call starts, settles, is polled for
 * freshness, read for its tail, noticed finished in the background, trimmed.
 */
import type { ShellCall, ShellStatus } from "../../types";
import {
  exitCodeOf,
  isNoMatchCommand,
  labelOf,
  lastLines,
  outputPathOf,
  promptWordsOf,
  runnerOf,
  type TaskNotice,
  verdictOf,
  watchPathOf,
} from "./parse.ts";

const TAIL_LINES = 40;

/** Silence, in ms, after which a running call is quiet, then hung. */
export interface Limits {
  readonly quietMs: number;
  readonly hangMs: number;
}

/** What a Bash call's input carries that the list keeps. */
export interface BashStart {
  readonly tool_use_id: string;
  readonly command: string;
  readonly description?: string | undefined;
  readonly agentId?: string | undefined;
}

/** What a Bash call's result carries that the list keeps. */
export interface BashOutcome {
  readonly isError: boolean;
  readonly text: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly interrupted?: boolean;
  readonly backgroundTaskId?: string | undefined;
  readonly denied?: string;
}

/** What `$.fs.stat` answered for a watched file. */
export interface FileStat {
  readonly size: number;
  readonly mtimeMs: number;
}

const LIVE: ReadonlySet<ShellStatus> = new Set(["running", "quiet", "hung"]);
const RANK: Readonly<Record<ShellStatus, number>> = {
  hung: 0,
  failed: 1,
  quiet: 2,
  running: 3,
  stopped: 4,
  denied: 6,
  done: 5,
  nomatch: 5,
};

/**
 * Whether the call still runs (running, quiet or hung).
 * @param call the call
 * @returns true while it runs
 */
export const isLive = (call: ShellCall): boolean => LIVE.has(call.status);

/**
 * Whether any call still runs.
 * @param calls the list
 * @returns true when one does
 */
export const hasLive = (calls: readonly ShellCall[]): boolean =>
  calls.some((call) => LIVE.has(call.status));

/**
 * The calls that still run: what `clear` keeps.
 * @param calls the list
 * @returns the live calls
 */
export const liveOnly = (calls: readonly ShellCall[]): readonly ShellCall[] =>
  calls.filter((call) => LIVE.has(call.status));

/**
 * The ids of the finished calls: what `clear` forgets for good.
 * @param calls the list
 * @returns their ids
 */
export const finishedIds = (calls: readonly ShellCall[]): readonly string[] =>
  calls.filter((call) => !LIVE.has(call.status)).map((call) => call.id);

/**
 * A call as the Bash input starts it.
 * @param input the tool call's input
 * @param now the clock's time
 * @returns the running call
 */
export const started = (input: BashStart, now: number): ShellCall => {
  const runner = runnerOf(input.command);
  const watchPath = watchPathOf(input.command);
  return {
    id: input.tool_use_id,
    ...(input.agentId !== undefined && { agentId: input.agentId }),
    label: labelOf(
      input.description,
      runner === undefined
        ? input.command
        : (promptWordsOf(input.command) ?? input.command),
    ),
    command: input.command,
    startedAt: now,
    background: false,
    ...(runner !== undefined && { runner }),
    ...(watchPath !== undefined && { watchPath }),
    tail: [],
    stderr: [],
    status: "running",
  };
};

const ended = (
  call: ShellCall,
  status: ShellStatus,
  now: number,
): ShellCall => ({ ...call, status, endedAt: now });

// A search or test tool's exit 1 is "no match" (or "differ", "false").
const NO_MATCH = 1;

/** How a call ended: its status and exit code, if known. */
interface Ending {
  readonly status: ShellStatus;
  readonly exitCode: number | undefined;
}

const endedWith = (call: ShellCall, ending: Ending, now: number): ShellCall =>
  ending.status === "failed" &&
  ending.exitCode === NO_MATCH &&
  isNoMatchCommand(call.command)
    ? { ...ended(call, "nomatch", now), verdict: "no match" }
    : ended(call, ending.status, now);

const backgrounded = (
  call: ShellCall,
  taskId: string,
  text: string,
): ShellCall => {
  const outputPath = outputPathOf(text);
  return {
    ...call,
    background: true,
    taskId,
    ...(outputPath !== undefined && { outputPath }),
  };
};

const finished = (
  call: ShellCall,
  outcome: BashOutcome,
  now: number,
): ShellCall => {
  const lines = lastLines(
    outcome.isError ? outcome.text : (outcome.stdout ?? outcome.text),
    TAIL_LINES,
  );
  const verdict = call.runner === undefined ? undefined : verdictOf(lines);
  const exitCode = outcome.isError ? exitCodeOf(outcome.text) : 0;
  return {
    ...endedWith(
      call,
      { status: outcome.isError ? "failed" : "done", exitCode },
      now,
    ),
    ...(exitCode !== undefined && { exitCode }),
    tail: outcome.isError ? call.tail : lines,
    stderr: outcome.isError
      ? lines
      : lastLines(outcome.stderr ?? "", TAIL_LINES),
    ...(verdict !== undefined && { verdict }),
  };
};

const stoppedOrFinished = (
  call: ShellCall,
  outcome: BashOutcome,
  now: number,
): ShellCall =>
  outcome.interrupted === true || outcome.denied !== undefined
    ? {
        ...ended(
          call,
          outcome.denied === undefined ? "stopped" : "denied",
          now,
        ),
        ...(outcome.denied !== undefined && {
          verdict: "denied",
          stderr: lastLines(outcome.denied, TAIL_LINES),
        }),
      }
    : finished(call, outcome, now);

/**
 * A call as its result leaves it: finished, stopped, or gone to background.
 * @param call the running call
 * @param outcome the result's fields
 * @param now the clock's time
 * @returns the call after the result
 */
export const settled = (
  call: ShellCall,
  outcome: BashOutcome,
  now: number,
): ShellCall => {
  const taskId = outcome.isError ? undefined : outcome.backgroundTaskId;
  return taskId === undefined
    ? stoppedOrFinished(call, outcome, now)
    : backgrounded(call, taskId, outcome.text);
};

const NOTICED: Readonly<Record<string, ShellStatus>> = {
  completed: "done",
  failed: "failed",
};

const settledBy = (
  call: ShellCall,
  notice: TaskNotice,
  now: number,
): ShellCall => ({
  ...endedWith(
    call,
    {
      status: NOTICED[notice.status] ?? "stopped",
      exitCode: notice.exitCode,
    },
    now,
  ),
  ...(notice.exitCode !== undefined && { exitCode: notice.exitCode }),
  ...(call.outputPath !== undefined && { needsTail: true }),
});

/**
 * The calls after background tasks' notifications: each one's call settled,
 * and its output marked for one last read (a runner's verdict, the final
 * lines of an expanded row).
 * @param calls the list
 * @param notices the notifications
 * @param now the clock's time
 * @returns the list
 */
export const noticed = (
  calls: readonly ShellCall[],
  notices: readonly TaskNotice[],
  now: number,
): readonly ShellCall[] =>
  calls.map((call) => {
    const notice = notices.find((one) => one.taskId === call.taskId);
    return notice !== undefined && isLive(call)
      ? settledBy(call, notice, now)
      : call;
  });

const quietOr = (silent: number, limits: Limits): ShellStatus =>
  silent > limits.quietMs ? "quiet" : "running";

/**
 * A live watched call's status by how long its output has been silent.
 * @param call the call
 * @param now the clock's time
 * @param limits quiet and hang thresholds
 * @returns the call, reclassified
 */
export const classified = (
  call: ShellCall,
  now: number,
  limits: Limits,
): ShellCall => {
  const isWatched =
    call.outputPath !== undefined || call.watchPath !== undefined;
  const silent = now - (call.lastOutputAt ?? call.startedAt);
  const status: ShellStatus =
    silent > limits.hangMs ? "hung" : quietOr(silent, limits);
  return isWatched && isLive(call) ? { ...call, status } : call;
};

/**
 * A call after a stat of its watched file: new bytes are new output; an
 * empty file is no output yet.
 * @param call the call
 * @param stat the file's size and mtime
 * @param now the clock's time
 * @returns the call with its freshness
 */
export const polled = (
  call: ShellCall,
  stat: FileStat,
  now: number,
): ShellCall =>
  stat.size === call.outputBytes
    ? call
    : {
        ...call,
        outputBytes: stat.size,
        ...(stat.size > 0 && { lastOutputAt: Math.min(stat.mtimeMs, now) }),
      };

/**
 * A call after a read of its output file: the tail, and a runner's verdict;
 * a pending final read is done.
 * @param call the call
 * @param text the file's text
 * @returns the call with its tail
 */
export const tailed = (call: ShellCall, text: string): ShellCall => {
  const tail = lastLines(text, TAIL_LINES);
  const verdict = call.runner === undefined ? undefined : verdictOf(tail);
  return {
    ...call,
    tail,
    needsTail: false,
    ...(verdict !== undefined && { verdict }),
  };
};

/**
 * The list cut to `max`, the oldest finished calls dropped first.
 * @param calls the list, oldest first
 * @param max how many to keep
 * @returns the list
 */
export const trimmed = (
  calls: readonly ShellCall[],
  max: number,
): readonly ShellCall[] => {
  const drop = new Set(
    calls
      .filter((call) => !isLive(call))
      .slice(0, Math.max(0, calls.length - max))
      .map((call) => call.id),
  );
  return calls.filter((call) => !drop.has(call.id));
};

/**
 * The calls most urgent first: hung, failed, quiet, running; runners ahead
 * of plain shells within a rank, then the newest.
 * @param calls the list
 * @returns a sorted copy
 */
export const urgencyOrder = (
  calls: readonly ShellCall[],
): readonly ShellCall[] =>
  calls.toSorted(
    (a, b) =>
      RANK[a.status] - RANK[b.status] ||
      Number(a.runner === undefined) - Number(b.runner === undefined) ||
      b.startedAt - a.startedAt,
  );
