/**
 * The pane's tree: housekeeping buttons, then each agent's group (its
 * header, and the rows of an open group), the most urgent group first, as
 * many lines as fit the height.
 */
import type { RenderElement } from "claude-code";

import type { ShellCall } from "../../types";
import { GLYPH, noteOf } from "../model/format.ts";
import {
  type AgentTable,
  type Folds,
  type Group,
  groupsOf,
  type GroupStatus,
} from "../model/groups.ts";
import { fit, oneLine } from "../model/layout.ts";
import { type PaneItem, paneLayoutOf } from "../model/pane-items.ts";
import {
  canStop,
  COLOR,
  digitOf,
  type Kit,
  type RowActions,
  type RowContext,
  rowOf,
  type RowView,
  toggleLabelOf,
} from "./row.tsx";

/** What the pane draws. */
export interface PaneView extends RowView {
  readonly calls: readonly ShellCall[];
  readonly agents: AgentTable;
  readonly folds: Folds;
  /** The pane body's height in rows (`e.props.scroll.bodyRows`). */
  readonly rows: number;
  /** Whether the pane holds the keyboard (`e.props.isFocused`). */
  readonly isFocused: boolean;
}

/** What the pane's buttons do. */
export interface PaneActions extends RowActions {
  readonly clear: () => void;
  readonly close: () => void;
  readonly fold: (key: string, isFolded: boolean) => void;
  readonly foldAll: (keys: readonly string[], isFolded: boolean) => void;
}

// The toolbar and the hint line around the lines.
const CHROME_ROWS = 2;
// `[ 1 ▾ ] ◌ ` before a header's label.
const HEADER_PREFIX = 10;
// The terminal does not draw a bracketed Button's hotkey, so each label
// carries its own key: [ 1 ▸ ], [ f fold ], [ c clear ], [ q close ].
const HINT_FOCUSED = "1–9 open · f fold · c clear · q close · Esc → prompt";
const HINT_UNFOCUSED = "/shell-watch → keys";

const GROUP_GLYPH: Readonly<Record<GroupStatus, string>> = {
  ...GLYPH,
  idle: "◌",
};
const GROUP_COLOR: Readonly<Record<GroupStatus, string>> = {
  ...COLOR,
  idle: "gray",
};

const summaryOf = (group: Group, isFolded: boolean): string => {
  const plural = group.calls.length === 1 ? "" : "s";
  const count = `${String(group.calls.length)} call${plural}`;
  const live = group.live > 0 ? ` · ${String(group.live)} live` : "";
  const lead = group.calls[0];
  const note = isFolded && lead !== undefined ? noteOf(lead) : undefined;
  const says = note === undefined ? "" : ` · › ${note.text}`;
  return ` · ${count}${live}${says}`;
};

const headerOf = (
  kit: Readonly<Kit>,
  context: Readonly<{ view: PaneView; act: PaneActions }>,
  item: Readonly<{ group: Group; isFolded: boolean; index: number }>,
): Readonly<RenderElement> => {
  const { Box, Button, Text } = kit;
  const { group, isFolded, index } = item;
  const label = fit(oneLine(group.label), context.view.columns - HEADER_PREFIX);
  const rest = context.view.columns - HEADER_PREFIX - label.length;
  return (
    <Box key={`head:${group.key}`} flexDirection="row" gap={1}>
      <Button
        key={`group:${group.key}`}
        label={toggleLabelOf(index, !isFolded)}
        {...digitOf(index)}
        {...(index === 0 && { autoFocus: true })}
        onPress={() => {
          context.act.fold(group.key, !isFolded);
        }}
      />
      <Text color={GROUP_COLOR[group.status]}>{GROUP_GLYPH[group.status]}</Text>
      <Text bold>{label}</Text>
      <Text dimColor wrap="truncate-end">
        {fit(oneLine(summaryOf(group, isFolded)), rest)}
      </Text>
    </Box>
  );
};

const toolbarOf = (
  kit: Readonly<Kit>,
  act: PaneActions,
  groups: readonly PaneItem[],
): Readonly<RenderElement> => {
  const { Box, Button } = kit;
  const headers = groups.filter((item) => item.kind === "header");
  const isAnyOpen = headers.some((item) => !item.isFolded);
  return (
    <Box flexDirection="row" gap={1}>
      <Button
        key="fold"
        label="f fold"
        hotkey="f"
        onPress={() => {
          act.foldAll(
            headers.map((item) => item.group.key),
            isAnyOpen,
          );
        }}
      />
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
 * The pane's tree.
 * @param kit the surface's Box, Button and Text
 * @param view the calls, the agents and the pane's own state
 * @param act the buttons' handlers
 * @returns the tree
 */
export const paneTree = (
  kit: Readonly<Kit>,
  view: PaneView,
  act: PaneActions,
): Readonly<RenderElement> => {
  const { Box, Text } = kit;
  const groups = groupsOf(view.calls, view.agents, view.now);
  const layout = paneLayoutOf(groups, view.folds, {
    selected: view.selected,
    budget: view.rows - CHROME_ROWS,
  });
  const stoppable = layout.items.filter(
    (item) => item.kind === "row" && canStop(item.call),
  );
  const only = stoppable.length === 1 ? stoppable[0] : undefined;
  const context: RowContext = {
    view,
    act,
    stopKey: only?.kind === "row" ? only.call.id : "",
    fit: layout,
  };
  return (
    <Box flexDirection="column">
      {toolbarOf(kit, act, layout.items)}
      {layout.items.length === 0 && <Text dimColor>No Bash calls yet.</Text>}
      {layout.items.map((item, index) =>
        item.kind === "header"
          ? headerOf(kit, { view, act }, { ...item, index })
          : rowOf(kit, context, { call: item.call, index }),
      )}
      {layout.hidden > 0 && (
        <Text dimColor>{`+${String(layout.hidden)} older`}</Text>
      )}
      <Text dimColor wrap="truncate-end">
        {fit(view.isFocused ? HINT_FOCUSED : HINT_UNFOCUSED, view.columns)}
      </Text>
    </Box>
  );
};
