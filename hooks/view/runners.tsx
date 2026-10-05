/**
 * The runners view: only the external runners' calls, flat, most urgent
 * first, each row saying which agent started it.
 */
import type { RenderElement } from "claude-code";

import type { ShellCall, ShellLimits } from "../../types";
import { isLive } from "../model/calls.ts";
import type { AgentTable } from "../model/groups.ts";
import { fit, visibleOf } from "../model/layout.ts";
import { blockedOf, limitsLineOf } from "../model/limits.ts";
import { type Runner, runnersOf } from "../model/runners.ts";
import {
  canStop,
  type Kit,
  type RowActions,
  type RowContext,
  rowOf,
  type RowView,
} from "./row.tsx";

/** What both views of the pane draw. */
export interface RunnersView extends RowView {
  readonly calls: readonly ShellCall[];
  readonly agents: AgentTable;
  /** What the last read of the executors' subscription limits found. */
  readonly limits: ShellLimits;
  /** The pane body's height in rows (`e.props.scroll.bodyRows`). */
  readonly rows: number;
  /** Whether the pane holds the keyboard (`e.props.isFocused`). */
  readonly isFocused: boolean;
}

/** What the buttons of both views do. */
export interface RunnersActions extends RowActions {
  readonly clear: () => void;
  readonly close: () => void;
  /** The `r` key: the other view. */
  readonly toggle: () => void;
}

/** The toolbar and the hint line around the lines. */
export const CHROME_ROWS = 2;
// The summary line and the limits line under the toolbar.
const SUMMARY_ROWS = 2;
const HINT_FOCUSED = "1–9 open · r agents · c clear · q close · Esc → prompt";
const HINT_UNFOCUSED = "/shell-watch → keys";

const summaryOf = (calls: readonly ShellCall[]): string => {
  const live = calls.filter(isLive).length;
  const failed = calls.filter((call) => call.status === "failed").length;
  return [
    `runners · ${String(calls.length)}`,
    ...(live > 0 ? [`${String(live)} live`] : []),
    ...(failed > 0 ? [`${String(failed)} failed`] : []),
  ].join(" · ");
};

const summaryLineOf = (
  kit: Readonly<Kit>,
  runners: readonly Runner[],
  columns: number,
): Readonly<RenderElement> => {
  const { Text } = kit;
  return runners.length === 0 ? (
    <Text dimColor>No runners yet.</Text>
  ) : (
    <Text dimColor wrap="truncate-end">
      {fit(summaryOf(runners.map(({ call }) => call)), columns)}
    </Text>
  );
};

const limitsLineElementOf = (
  kit: Readonly<Kit>,
  view: RunnersView,
): Readonly<RenderElement> => {
  const { Text } = kit;
  const isBlocked = blockedOf(view.limits, view.now).length > 0;
  return (
    <Text
      dimColor={!isBlocked}
      wrap="truncate-end"
      {...(isBlocked && { color: "yellow" })}
    >
      {fit(limitsLineOf(view.limits, view.now), view.columns)}
    </Text>
  );
};

const toolbarOf = (
  kit: Readonly<Kit>,
  act: RunnersActions,
): Readonly<RenderElement> => {
  const { Box, Button } = kit;
  return (
    <Box flexDirection="row" gap={1}>
      <Button key="view" label="r agents" hotkey="r" onPress={act.toggle} />
      <Button key="clear" label="c clear" hotkey="c" onPress={act.clear} />
      <Button
        key="close"
        label="q close"
        role="dismiss"
        hotkey="q"
        onPress={act.close}
      />
    </Box>
  );
};

/**
 * The runners view's tree: toolbar (no fold), the summary and limits lines, one row per
 * runner as many as fit, and its own hint.
 * @param kit the surface's Box, Button and Text
 * @param view the calls, the agents and the pane's own state
 * @param act the buttons' handlers
 * @returns the tree
 */
export const runnersTree = (
  kit: Readonly<Kit>,
  view: RunnersView,
  act: RunnersActions,
): Readonly<RenderElement> => {
  const { Box, Text } = kit;
  const runners = runnersOf(view.calls, view.agents);
  const layout = visibleOf(
    runners.map(({ call }) => call),
    view.selected,
    view.rows - CHROME_ROWS - SUMMARY_ROWS,
  );
  const stoppable = layout.shown.filter(canStop);
  const only = stoppable.length === 1 ? stoppable[0] : undefined;
  const context: RowContext = {
    view,
    act,
    stopKey: only?.id ?? "",
    fit: layout,
  };
  const shown = new Set(layout.shown.map((call) => call.id));
  return (
    <Box flexDirection="column">
      {toolbarOf(kit, act)}
      {summaryLineOf(kit, runners, view.columns)}
      {limitsLineElementOf(kit, view)}
      {runners
        .filter(({ call }) => shown.has(call.id))
        .map(({ call, by }, index) => rowOf(kit, context, { call, index, by }))}
      {layout.hidden > 0 && (
        <Text dimColor>{`+${String(layout.hidden)} older`}</Text>
      )}
      <Text dimColor wrap="truncate-end">
        {fit(view.isFocused ? HINT_FOCUSED : HINT_UNFOCUSED, view.columns)}
      </Text>
    </Box>
  );
};
