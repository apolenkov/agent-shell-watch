/**
 * The pane's lines, grouped: each group's header, then the rows of an open
 * group, fitted to the height.
 */
import type { ShellCall, ShellView } from "../../types";
import {
  type AgentTable,
  type Folds,
  type Group,
  groupsOf,
  isFolded,
} from "./groups.ts";
import { rowsOf, type Visible, visibleOf } from "./layout.ts";
import { type Runner, runnersOf } from "./runners.ts";

/** One line the pane leads with a button: a group's header or a call. */
export type PaneItem =
  | Readonly<{ kind: "header"; group: Group; isFolded: boolean }>
  | Readonly<{ kind: "row"; call: ShellCall }>;

/** The pane's lines, what did not fit, and how the rows draw. */
export interface PaneLayout extends Pick<Visible, "isCompact" | "detailRoom"> {
  readonly items: readonly PaneItem[];
  readonly hidden: number;
}

const CHROME = 2;
const ROWS_MIN = 6;
const ROWS_MAX = 30;

const sumOf = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

const openCallsOf = (
  groups: readonly Group[],
  folds: Folds,
): readonly ShellCall[] =>
  groups
    .filter((group) => !isFolded(group, folds))
    .flatMap((group) => group.calls);

/**
 * The pane's lines for `budget` rows: every group's header (a folded group
 * costs one line), and the rows of open groups, as one list in group order,
 * fitted by `visibleOf` to what the headers leave (compact, then `+N older`).
 * @param groups the groups, most urgent first
 * @param folds the person's fold choices
 * @param room the expanded row's id and the lines headers and rows may take
 * @returns the lines, the count left out, and how rows draw
 */
export const paneLayoutOf = (
  groups: readonly Group[],
  folds: Folds,
  room: Readonly<{ selected: string; budget: number }>,
): PaneLayout => {
  const { selected, budget } = room;
  const rows = visibleOf(
    openCallsOf(groups, folds),
    selected,
    budget - groups.length,
  );
  const shown = new Set(rows.shown.map((call) => call.id));
  return {
    items: groups.flatMap((group): readonly PaneItem[] => [
      { kind: "header", group, isFolded: isFolded(group, folds) },
      ...group.calls
        .filter((call) => !isFolded(group, folds) && shown.has(call.id))
        .map((call) => ({ kind: "row" as const, call })),
    ]),
    hidden: rows.hidden,
    isCompact: rows.isCompact,
    detailRoom: rows.detailRoom,
  };
};

/**
 * The body rows to ask for when the pane opens inline: every header and the
 * rows of open groups in full, with the toolbar and the hint, 6 to 30.
 * @param groups the groups
 * @param folds the person's fold choices
 * @returns the rows
 */
export const rowsWantedOf = (
  groups: readonly Group[],
  folds: Folds,
): number => {
  const rows = openCallsOf(groups, folds).map((call) => rowsOf(call, ""));
  const full = CHROME + groups.length + sumOf(rows);
  return Math.min(ROWS_MAX, Math.max(ROWS_MIN, full));
};

/**
 * The body rows to ask for in the runners view: the toolbar, the hint, the
 * summary line, and every runner in full, 6 to 30.
 * @param runners the runners
 * @returns the rows
 */
export const runnerRowsWantedOf = (runners: readonly Runner[]): number => {
  const full = CHROME + 1 + sumOf(runners.map(({ call }) => rowsOf(call, "")));
  return Math.min(ROWS_MAX, Math.max(ROWS_MIN, full));
};

/** What the pane's height depends on. */
export interface WantedState {
  readonly view: ShellView;
  readonly calls: readonly ShellCall[];
  readonly agents: AgentTable;
  readonly folds: Folds;
  readonly now: number;
}

/**
 * The body rows to ask for now: the open view's own count, 6 to 30. The one
 * place the command, the pane's keys and a restore ask.
 * @param state the view, the calls, the agents, the folds and the time
 * @returns the rows
 */
export const rowsWantedFor = (state: WantedState): number =>
  state.view === "runners"
    ? runnerRowsWantedOf(runnersOf(state.calls, state.agents))
    : rowsWantedOf(groupsOf(state.calls, state.agents, state.now), state.folds);
