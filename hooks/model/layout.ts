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
 * calls, denied ones last; the newest first within each.
 * @param calls the list
 * @returns a sorted copy
 */
export const paneOrder = (calls: readonly ShellCall[]): readonly ShellCall[] =>
  calls.toSorted(
    (a, b) => GROUP[a.status] - GROUP[b.status] || b.startedAt - a.startedAt,
  );

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

/** The rows that fit, and how many older ones did not. */
export interface Visible {
  readonly shown: readonly ShellCall[];
  readonly hidden: number;
}

/**
 * The rows that fit `budget` lines, keeping one for `+N older` when some do
 * not: the last (oldest finished) rows go first, a live row never.
 * @param ordered the rows in pane order
 * @param selected the expanded row's id
 * @param budget the lines the rows may take
 * @returns the rows shown and the count left out
 */
export const visibleOf = (
  ordered: readonly ShellCall[],
  selected: string,
  budget: number,
): Visible => {
  const lines = ordered.map((call) => rowsOf(call, selected));
  const limit = sumOf(lines) <= budget ? budget : budget - 1;
  const shown = ordered.filter(
    (call, index) => isLive(call) || sumOf(lines.slice(0, index + 1)) <= limit,
  );
  return { shown, hidden: ordered.length - shown.length };
};
