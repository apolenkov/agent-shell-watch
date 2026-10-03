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
export const saysOf = (call: ShellCall): string | undefined =>
  call.tail.findLast((line) => line.trim() !== "")?.trim();

const silentOf = (call: ShellCall, now: number): string =>
  agoOf(now - (call.lastOutputAt ?? call.startedAt));

const runningSegment = (call: ShellCall, now: number): string => {
  const says = saysOf(call);
  return [
    `◐ ${nameOf(call)} ${clockOf(now - call.startedAt)}`,
    ...(call.lastOutputAt === undefined
      ? []
      : [`output ${agoOf(now - call.lastOutputAt)} ago`]),
    ...(says === undefined ? [] : [`› ${cut(says, SAYS_MAX)}`]),
  ].join(" · ");
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
};

interface Counted {
  readonly status: ShellStatus;
  readonly isBackground?: boolean;
  readonly lead: string;
  readonly unit: string;
}

const COUNTED: readonly Counted[] = [
  { status: "hung", lead: "⚠ ", unit: " hung" },
  { status: "failed", lead: "✗ ", unit: " failed" },
  { status: "quiet", lead: "⚠ ", unit: " quiet" },
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
    : `shell: ${[SEGMENT[head.status](head, now), ...countsOf(rest)].join(" · ")}`;
};
