/**
 * How the pane lays its rows out: one-line text cut to the width, the order
 * the rows go in, and which rows fit the height.
 */
import type { ShellCall, ShellStatus } from "../../types";
import { isLive } from "./calls.ts";
import { noteOf } from "./format.ts";

const HEAD_AND_SOURCE = 2;

const GROUP: Readonly<Record<ShellStatus, number>> = {
  hung: 0,
  quiet: 1,
  running: 2,
  failed: 3,
  done: 4,
  stopped: 4,
  nomatch: 4,
  denied: 5,
};

/**
 * Text on one line: every run of whitespace, newlines included, one space.
 * @param text the text
 * @returns the line
 */
export const oneLine = (text: string): string =>
  text.replaceAll(/\s+/gu, " ").trim();

/**
 * Text cut to a width, the last cell an ellipsis when cut.
 * @param text the text
 * @param width the cells available
 * @returns the text, at most `width` long
 */
export const fit = (text: string, width: number): string => {
  const room = Math.max(0, width);
  return text.length > room
    ? `${text.slice(0, Math.max(0, room - 1))}…`.slice(0, room)
    : text;
};

/**
 * The pane's order: live calls (hung, quiet, running), failures, finished
 * calls, denied ones last; the newest first within each, the later in the
 * list first where start times tie (rebuilt calls share one).
 * @param calls the list
 * @returns a sorted copy
 */
export const paneOrder = (calls: readonly ShellCall[]): readonly ShellCall[] =>
  calls
    .map((call, index) => ({ call, index }))
    .toSorted(
      (a, b) =>
        GROUP[a.call.status] - GROUP[b.call.status] ||
        b.call.startedAt - a.call.startedAt ||
        b.index - a.index,
    )
    .map(({ call }) => call);
/**
 * The lines an expanded row adds: its full command, tail, stderr and files.
 * @param call the call
 * @returns the lines
 */
export const detailsOf = (call: ShellCall): readonly string[] => [
  ...`$ ${call.command}`.split("\n"),
  ...call.tail,
  ...call.stderr.map((line) => `stderr: ${line}`),
  ...(call.outputPath === undefined ? [] : [`output: ${call.outputPath}`]),
  ...(call.watchPath === undefined ? [] : [`watch: ${call.watchPath}`]),
];

/**
 * The lines a row takes: head, source, its note, and its expansion.
 * @param call the call
 * @param selected the expanded row's id
 * @returns the line count
 */
export const rowsOf = (call: ShellCall, selected: string): number =>
  HEAD_AND_SOURCE +
  (noteOf(call) === undefined ? 0 : 1) +
  (selected === call.id ? detailsOf(call).length : 0);

const sumOf = (values: readonly number[]): number =>
  values.length === 0 ? 0 : (values[0] ?? 0) + sumOf(values.slice(1));

/** The rows that fit, how many older ones did not, and how they draw. */
export interface Visible {
  readonly shown: readonly ShellCall[];
  readonly hidden: number;
  /** Rows but the selected one take one line (state and label). */
  readonly isCompact: boolean;
  /** The lines the selected row's details may take. */
  readonly detailRoom: number;
}

const baseOf = (call: ShellCall): number =>
  HEAD_AND_SOURCE + (noteOf(call) === undefined ? 0 : 1);

// Live and failed rows, and the selected one, are always drawn.
const isKept = (call: ShellCall, selected: string): boolean =>
  isLive(call) || call.status === "failed" || call.id === selected;

/**
 * Whether a compact row still draws its note: a live runner's last line is
 * what the pane is for, so it stays.
 * @param call the call
 * @returns true when the note stays
 */
export const isNoteKept = (call: ShellCall): boolean =>
  call.runner !== undefined && isLive(call) && noteOf(call) !== undefined;

const compactLinesOf = (call: ShellCall, selected: string): number =>
  call.id === selected ? baseOf(call) + 1 : 1 + Number(isNoteKept(call));

const prefixFit = (lines: readonly number[], room: number): number =>
  lines.filter((_, index) => sumOf(lines.slice(0, index + 1)) <= room).length;

const compactOf = (
  ordered: readonly ShellCall[],
  selected: string,
  budget: number,
): Visible => {
  const linesOf = (calls: readonly ShellCall[]): readonly number[] =>
    calls.map((call) => compactLinesOf(call, selected));
  const kept = ordered.filter((call) => isKept(call, selected));
  const optional = ordered.filter((call) => !isKept(call, selected));
  const room = budget - sumOf(linesOf(kept));
  const isAll = sumOf(linesOf(optional)) <= room;
  const count = isAll
    ? optional.length
    : prefixFit(linesOf(optional), room - 1);
  const taken = new Set(optional.slice(0, count).map((call) => call.id));
  const shown = ordered.filter(
    (call) => isKept(call, selected) || taken.has(call.id),
  );
  const hidden = ordered.length - shown.length;
  const others = sumOf(
    shown
      .filter((call) => call.id !== selected)
      .map((call) => compactLinesOf(call, selected)),
  );
  const chosen = shown.find((call) => call.id === selected);
  const detailRoom =
    budget -
    others -
    (chosen === undefined ? 0 : baseOf(chosen)) -
    Math.min(1, hidden);
  return { shown, hidden, isCompact: true, detailRoom };
};

/**
 * The rows that fit `budget` lines. Short of room, every row but the selected
 * one draws on one line; then the oldest finished and denied rows go, leaving
 * a line for `+N older`. Live, failed and selected rows are always drawn.
 * @param ordered the rows in pane order
 * @param selected the expanded row's id
 * @param budget the lines the rows may take
 * @returns the rows shown, the count left out, and how they draw
 */
export const visibleOf = (
  ordered: readonly ShellCall[],
  selected: string,
  budget: number,
): Visible =>
  sumOf(ordered.map((call) => rowsOf(call, selected))) <= budget
    ? {
        shown: ordered,
        hidden: 0,
        isCompact: false,
        detailRoom: Infinity,
      }
    : compactOf(ordered, selected, budget);

/**
 * The newest lines that fit `room`, the earlier ones counted on top.
 * @param lines the lines, oldest first
 * @param room the lines available
 * @returns the lines to draw
 */
export const tailFit = (
  lines: readonly string[],
  room: number,
): readonly string[] => {
  const count = Math.max(0, room - 1);
  const newest = count === 0 ? [] : lines.slice(-count);
  const cut = [`… ${String(lines.length - count)} earlier lines`, ...newest];
  return lines.length <= room ? lines : cut.slice(0, Math.max(0, room));
};
