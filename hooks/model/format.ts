/**
 * Pure text of the status line and the pane's rows: elapsed time, output
 * freshness, a runner's last words and its verdict.
 */
import type { ShellCall, ShellStatus } from "../../types";
import { isLive, urgencyOrder } from "./calls.ts";

const SECOND = 1000;
const SIXTY = 60;
const MINUTE = SIXTY * SECOND;
const HOUR = SIXTY * MINUTE;
const FAILED_SHOWN_MS = 120_000;
const PAD = 2;
const NAME_MAX = 40;
const SAYS_MAX = 40;

/** The glyph a status draws with. */
export const GLYPH: Readonly<Record<ShellStatus, string>> = {
  running: "◐",
  quiet: "⚠",
  hung: "⚠",
  done: "●",
  failed: "✗",
  stopped: "○",
  denied: "○",
};

const pad = (n: number): string => String(n).padStart(PAD, "0");

/**
 * Elapsed time as a clock: `2:13`, `1:02:03`.
 * @param ms milliseconds
 * @returns the clock text
 */
export const clockOf = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / SECOND));
  const m = Math.floor(s / SIXTY) % SIXTY;
  const h = Math.floor(s / SIXTY / SIXTY);
  const tail = `${pad(m)}:${pad(s % SIXTY)}`;
  return h > 0 ? `${String(h)}:${tail}` : tail.replace(/^0/u, "");
};

const UNITS: readonly (readonly [number, string])[] = [
  [HOUR, "h"],
  [MINUTE, "m"],
];

/**
 * An age in its largest unit: `4s`, `6m`, `2h`.
 * @param ms milliseconds
 * @returns the age text
 */
export const agoOf = (ms: number): string => {
  const [size, unit] = UNITS.find(([at]) => ms >= at) ?? [SECOND, "s"];
  return `${String(Math.max(0, Math.floor(ms / size)))}${unit}`;
};

const cut = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The call's name: `codex · <label>` for a runner, the label otherwise.
 * @param call the call
 * @returns the name, cut to fit a status line
 */
export const nameOf = (call: ShellCall): string =>
  cut(
    call.runner === undefined ? call.label : `${call.runner} · ${call.label}`,
    NAME_MAX,
  );

/**
 * How the call ended: a runner's verdict, else `exit n`, else nothing.
 * @param call the call
 * @returns the outcome text, empty while unknown
 */
export const outcomeOf = (call: ShellCall): string =>
  call.verdict ??
  (call.exitCode === undefined ? "" : `exit ${String(call.exitCode)}`);

/**
 * The last non-empty output line the call has shown.
 * @param call the call
 * @returns the line, or undefined
 */
const saysOf = (call: ShellCall): string | undefined =>
  call.tail.findLast((line) => line.trim() !== "")?.trim();

const silentOf = (call: ShellCall, now: number): string =>
  agoOf(now - (call.lastOutputAt ?? call.startedAt));

const isWatched = (call: ShellCall): boolean =>
  call.outputPath !== undefined || call.watchPath !== undefined;

/**
 * How fresh a live call's output is: `output 4s ago`, `no output · 45s` for a
 * watched file still empty, nothing when nothing is watched.
 * @param call the call
 * @param now the clock's time
 * @returns the phrase, empty when unknown
 */
const silenceOf = (call: ShellCall, now: number): string =>
  isWatched(call) ? `no output · ${agoOf(now - call.startedAt)}` : "";

const freshOf = (call: ShellCall, now: number): string =>
  call.lastOutputAt === undefined
    ? silenceOf(call, now)
    : `output ${agoOf(now - call.lastOutputAt)} ago`;

const runningSegment = (call: ShellCall, now: number): string => {
  const says = saysOf(call);
  return [
    `◐ ${nameOf(call)} ${clockOf(now - call.startedAt)}`,
    freshOf(call, now),
    ...(says === undefined ? [] : [`› ${cut(says, SAYS_MAX)}`]),
  ]
    .filter((part) => part !== "")
    .join(" · ");
};

/**
 * Line 1's state, before the label so a narrow pane cuts the label first:
 * elapsed time, then freshness while live, else the outcome or the status.
 * @param call the call
 * @param now the clock's time
 * @returns `0:51 output 1s ago`, `6:00 quiet · output 6m ago`, `0:01 exit 0`
 */
export const stateOf = (call: ShellCall, now: number): string => {
  const elapsed = clockOf((call.endedAt ?? now) - call.startedAt);
  const live = [
    call.status === "running" ? "" : call.status,
    freshOf(call, now),
  ];
  const ended = [outcomeOf(call) === "" ? call.status : outcomeOf(call)];
  const parts = (isLive(call) ? live : ended).filter((part) => part !== "");
  return [elapsed, parts.join(" · ")].filter((part) => part !== "").join(" ");
};

/** What a row's third line says, and in which tone. */
export interface Note {
  readonly tone: "output" | "error" | "denied";
  readonly text: string;
}

const lastOf = (lines: readonly string[]): string | undefined =>
  lines.findLast((line) => line.trim() !== "")?.trim();

const TONE: Readonly<Partial<Record<ShellStatus, Note["tone"]>>> = {
  failed: "error",
  denied: "denied",
};

/**
 * A row's note: a denial's reason, a failure's last error line (else its
 * last output), otherwise the last output line.
 * @param call the call
 * @returns the note, or undefined when there is nothing to say
 */
export const noteOf = (call: ShellCall): Note | undefined => {
  const tone = TONE[call.status] ?? "output";
  const text =
    tone === "output"
      ? lastOf(call.tail)
      : (lastOf(call.stderr) ?? lastOf(call.tail));
  return text === undefined ? undefined : { tone, text };
};

const SEGMENT: Readonly<
  Record<ShellStatus, (call: ShellCall, now: number) => string>
> = {
  running: runningSegment,
  quiet: (call, now) =>
    `⚠ quiet ${silentOf(call, now)} ${nameOf(call)} ${clockOf(now - call.startedAt)}`,
  hung: (call, now) => `⚠ hung ${silentOf(call, now)} ${nameOf(call)}`,
  failed: (call) => `✗ ${nameOf(call)} ${outcomeOf(call)}`.trimEnd(),
  done: (call) => `● ${nameOf(call)}`,
  stopped: (call) => `○ ${nameOf(call)}`,
  denied: (call) => `○ ${nameOf(call)} denied`,
};

interface Counted {
  readonly status: ShellStatus;
  readonly isBackground?: boolean;
  readonly lead: string;
  readonly unit: string;
}

const COUNTED: readonly Counted[] = [
  { status: "hung", lead: "+", unit: " hung" },
  { status: "failed", lead: "+", unit: " failed" },
  { status: "quiet", lead: "+", unit: " quiet" },
  { status: "running", isBackground: true, lead: "+", unit: " bg" },
  { status: "running", isBackground: false, lead: "+", unit: " running" },
];

const countsOf = (rest: readonly ShellCall[]): readonly string[] =>
  COUNTED.map((rule) => ({
    n: rest.filter(
      (call) =>
        call.status === rule.status &&
        (rule.isBackground ?? call.background) === call.background,
    ).length,
    rule,
  }))
    .filter(({ n }) => n > 0)
    .map(({ n, rule }) => `${rule.lead}${String(n)}${rule.unit}`);

/**
 * The always-on line: the most urgent call in full, the rest counted.
 * @param calls the list
 * @param now the clock's time
 * @returns the line, or undefined when nothing runs or recently failed
 */
export const statusLineOf = (
  calls: readonly ShellCall[],
  now: number,
): string | undefined => {
  const shown = urgencyOrder(
    calls.filter(
      (call) =>
        isLive(call) ||
        (call.status === "failed" &&
          now - (call.endedAt ?? now) < FAILED_SHOWN_MS),
    ),
  );
  const [head, ...rest] = shown;
  return head === undefined
    ? undefined
    : [SEGMENT[head.status](head, now), ...countsOf(rest)].join(" · ");
};
