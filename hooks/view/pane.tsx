/**
 * The pane's tree: housekeeping buttons, then one row per call, live ones
 * first and the newest first, as many as fit the height, a selected row expanded to its command, tail and stderr.
 * Each row leads with a `[ ▸ ]` Button, so Tab reaches it and Enter expands.
 */
import type { Elements, RenderElement } from "claude-code";

import type { ShellAgents, ShellCall, ShellStatus } from "../../types";
import { isLive } from "../model/calls.ts";
import { GLYPH, nameOf, type Note, noteOf, stateOf } from "../model/format.ts";
import {
  detailsOf,
  fit,
  oneLine,
  paneOrder,
  visibleOf,
} from "../model/layout.ts";

/** The elements the pane draws with, on every surface that has a pane. */
export type Kit = Pick<Elements["terminal"], "Box" | "Button" | "Text">;

/** What the pane draws. */
export interface PaneView {
  readonly calls: readonly ShellCall[];
  readonly agents: ShellAgents;
  readonly now: number;
  readonly selected: string;
  /** The pane body's width in cells (`e.props.bodyColumns`). */
  readonly columns: number;
  /** The pane body's height in rows (`e.props.scroll.bodyRows`). */
  readonly rows: number;
  /** Whether the pane holds the keyboard (`e.props.isFocused`). */
  readonly isFocused: boolean;
}

/** What the pane's buttons do. */
export interface PaneActions {
  readonly clear: () => void;
  readonly close: () => void;
  readonly select: (id: string) => void;
  readonly stop: (taskId: string) => void;
}

const COLOR: Readonly<Record<ShellStatus, string>> = {
  running: "yellow",
  quiet: "yellow",
  hung: "red",
  done: "green",
  failed: "red",
  stopped: "gray",
  denied: "gray",
};

const sourceOf = (call: ShellCall, agents: ShellAgents): string => {
  const who =
    call.agentId === undefined
      ? "main"
      : (agents[call.agentId] ?? `agent ${call.agentId}`);
  return call.background ? `bg · ${who}` : who;
};

const NOTE_INDENT = 6;
// `[1 ▸] ● ` before the state, a gap before the label, `[s stop]` after it.
const HEAD_PREFIX = 9;
const STOP_WIDTH = 9;
// The toolbar and the hint line around the rows.
const CHROME_ROWS = 2;
const HOTKEYS = 9;
// The keys are drawn on the buttons themselves ([1 ▸], [c clear], [s stop]).
const HINT_FOCUSED = "keys press the [buttons] · Esc → prompt";
const HINT_UNFOCUSED = "/shell-flow → keys";

/** How a note's tone draws: its mark, and a color for errors. */
interface Look {
  readonly mark: string;
  readonly color?: string;
}

const NOTE_LOOK: Readonly<Record<Note["tone"], Look>> = {
  output: { mark: "›" },
  error: { mark: "✗", color: "red" },
  denied: { mark: "○" },
};

/** The view and its handlers, as every row reads them. */
interface Context {
  readonly view: PaneView;
  readonly act: PaneActions;
  /** The only stoppable row gets the `s` hotkey. */
  readonly stopKey: string;
}

/** One row as drawn: its call and its place among the shown rows. */
interface Row {
  readonly call: ShellCall;
  readonly index: number;
}

const canStop = (call: ShellCall): boolean =>
  call.background && isLive(call) && call.taskId !== undefined;

const digitOf = (index: number): Readonly<{ hotkey?: string }> =>
  index < HOTKEYS ? { hotkey: String(index + 1) } : {};

const stopOf = (
  kit: Readonly<Kit>,
  { act, stopKey }: Context,
  call: ShellCall,
): Readonly<RenderElement> | false => {
  const { Button } = kit;
  return (
    canStop(call) && (
      <Button
        key={`stop:${call.id}`}
        label="stop"
        {...(stopKey === call.id && { hotkey: "s" })}
        onPress={() => {
          act.stop(call.taskId ?? "");
        }}
      />
    )
  );
};

const headRowOf = (
  kit: Readonly<Kit>,
  { view, act, stopKey }: Context,
  { call, index }: Row,
): Readonly<RenderElement> => {
  const { Box, Button, Text } = kit;
  const state = fit(stateOf(call, view.now), view.columns - HEAD_PREFIX);
  const room =
    view.columns -
    HEAD_PREFIX -
    state.length -
    (canStop(call) ? STOP_WIDTH : 0);
  return (
    <Box flexDirection="row" gap={1}>
      <Button
        key={`row:${call.id}`}
        label={view.selected === call.id ? "▾" : "▸"}
        {...digitOf(index)}
        {...(index === 0 && { autoFocus: true })}
        onPress={() => {
          act.select(call.id);
        }}
      />
      <Text color={COLOR[call.status]}>{GLYPH[call.status]}</Text>
      <Text dimColor={call.status === "denied"}>{state}</Text>
      <Text dimColor={call.status === "denied"} wrap="truncate-end">
        {fit(oneLine(nameOf(call)), room)}
      </Text>
      {stopOf(kit, { view, act, stopKey }, call)}
    </Box>
  );
};

const noteRowOf = (
  kit: Readonly<Kit>,
  view: PaneView,
  call: ShellCall,
): readonly Readonly<RenderElement>[] => {
  const { Text } = kit;
  const note = noteOf(call);
  if (note === undefined) {
    return [];
  }
  const look = NOTE_LOOK[note.tone];
  const text = `${look.mark} ${note.text}`;
  return [
    <Text
      {...(look.color !== undefined && { color: look.color })}
      dimColor={note.tone !== "error"}
      wrap="truncate-end"
    >
      {fit(oneLine(text), view.columns - NOTE_INDENT)}
    </Text>,
  ];
};

const rowOf = (
  kit: Readonly<Kit>,
  context: Context,
  row: Row,
): Readonly<RenderElement> => {
  const { Box, Text } = kit;
  const { call } = row;
  const { view } = context;
  const details = view.selected === call.id ? detailsOf(call) : [];
  const source = `${sourceOf(call, view.agents)} · ${call.command}`;
  return (
    <Box key={`call:${call.id}`} flexDirection="column">
      {headRowOf(kit, context, row)}
      <Box paddingLeft={NOTE_INDENT} flexDirection="column">
        <Text dimColor wrap="truncate-end">
          {fit(oneLine(source), view.columns - NOTE_INDENT)}
        </Text>
        {noteRowOf(kit, view, call)}
        {details.map((line) => (
          <Text dimColor wrap="truncate-end">
            {fit(
              `  ${line.replaceAll("\t", "  ")}`,
              view.columns - NOTE_INDENT,
            )}
          </Text>
        ))}
      </Box>
    </Box>
  );
};

const toolbarOf = (
  kit: Readonly<Kit>,
  act: PaneActions,
): Readonly<RenderElement> => {
  const { Box, Button } = kit;
  return (
    <Box flexDirection="row" gap={1}>
      <Button key="clear" label="clear" hotkey="c" onPress={act.clear} />
      <Button
        key="close"
        label="close"
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
 * @param view the calls and the pane's own state
 * @param act the buttons' handlers
 * @returns the tree
 */
export const paneTree = (
  kit: Readonly<Kit>,
  view: PaneView,
  act: PaneActions,
): Readonly<RenderElement> => {
  const { Box, Text } = kit;
  const { shown, hidden } = visibleOf(
    paneOrder(view.calls),
    view.selected,
    view.rows - CHROME_ROWS,
  );
  const stoppable = shown.filter(
    (call) => call.taskId !== undefined && canStop(call),
  );
  const stopKey = stoppable.length === 1 ? (stoppable[0]?.id ?? "") : "";
  return (
    <Box flexDirection="column">
      {toolbarOf(kit, act)}
      {shown.length === 0 && <Text dimColor>No Bash calls yet.</Text>}
      {shown.map((call, index) =>
        rowOf(kit, { view, act, stopKey }, { call, index }),
      )}
      {hidden > 0 && <Text dimColor>{`+${String(hidden)} older`}</Text>}
      <Text dimColor wrap="truncate-end">
        {fit(view.isFocused ? HINT_FOCUSED : HINT_UNFOCUSED, view.columns)}
      </Text>
    </Box>
  );
};
