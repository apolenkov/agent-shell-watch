/**
 * One call's row in the pane: a toggle Button with its digit, the state
 * before the label (a narrow pane cuts the label), where it ran, its last
 * line, and when selected its details.
 */
import type { Elements, RenderElement } from "claude-code";

import type { ShellCall, ShellStatus } from "../../types";
import { isLive } from "../model/calls.ts";
import { GLYPH, nameOf, type Note, noteOf, stateOf } from "../model/format.ts";
import {
  detailsOf,
  fit,
  isNoteKept,
  oneLine,
  tailFit,
  type Visible,
} from "../model/layout.ts";

/** The elements the pane draws with, on every surface that has a pane. */
export type Kit = Pick<Elements["terminal"], "Box" | "Button" | "Text">;

/** What a row reads of the pane. */
export interface RowView {
  readonly now: number;
  readonly selected: string;
  /** The pane body's width in cells. */
  readonly columns: number;
}

/** What a row's buttons do. */
export interface RowActions {
  readonly select: (id: string) => void;
  readonly stop: (taskId: string) => void;
}

// Calls that did nothing wrong and nothing worth a look: drawn dim.
const DIM: ReadonlySet<ShellStatus> = new Set(["denied", "nomatch"]);

/** The color each status draws its glyph in. */
export const COLOR: Readonly<Record<ShellStatus, string>> = {
  running: "yellow",
  quiet: "yellow",
  hung: "red",
  done: "green",
  failed: "red",
  stopped: "gray",
  denied: "gray",
  nomatch: "gray",
};

// The group's header names the owner; a row says only where it ran.
const sourceOf = (call: ShellCall): string =>
  call.background ? `bg · ${oneLine(call.command)}` : oneLine(call.command);

/** Cells a row's lines below its head are indented by. */
const NOTE_INDENT = 6;
// `[1 ▸] ● ` before the state, a gap before the label, `[s stop]` after it.
const HEAD_PREFIX = 9;
const STOP_WIDTH = 9;
// The longest `← by` tag a runner row's head spends on its starter.
const BY_MAX = 32;
/** How many leading lines get a digit hotkey. */
const HOTKEYS = 9;

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
export interface RowContext {
  readonly view: RowView;
  readonly act: RowActions;
  /** The only stoppable row gets the `s` hotkey. */
  readonly stopKey: string;
  /** How the rows fit: compact rows, and the room for details. */
  readonly fit: Pick<Visible, "isCompact" | "detailRoom">;
}

/** One row as drawn: its call, its place among the shown lines, who started it. */
export interface Row {
  readonly call: ShellCall;
  readonly index: number;
  /** The agent that started the call, said in the head when set. */
  readonly by?: string;
}

/**
 * Whether the row can be stopped: a live background task.
 * @param call the call
 * @returns true when it can
 */
export const canStop = (call: ShellCall): boolean =>
  call.background && isLive(call) && call.taskId !== undefined;

/**
 * A line's toggle label: its digit while it has one, and the arrow.
 * @param index the line's place
 * @param isOpen whether it is open
 * @returns the label
 */
export const toggleLabelOf = (index: number, isOpen: boolean): string => {
  const arrow = isOpen ? "▾" : "▸";
  return index < HOTKEYS ? `${String(index + 1)} ${arrow}` : arrow;
};

/**
 * A line's digit hotkey, for the first nine.
 * @param index the line's place
 * @returns the hotkey prop, or none
 */
export const digitOf = (index: number): Readonly<{ hotkey?: string }> =>
  index < HOTKEYS ? { hotkey: String(index + 1) } : {};

const stopOf = (
  kit: Readonly<Kit>,
  { act, stopKey }: Pick<RowContext, "act" | "stopKey">,
  call: ShellCall,
): Readonly<RenderElement> | false => {
  const { Button } = kit;
  return (
    canStop(call) && (
      <Button
        key={`stop:${call.id}`}
        label={stopKey === call.id ? "s stop" : "stop"}
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
  { view, act, stopKey }: RowContext,
  { call, index, by }: Row,
): Readonly<RenderElement> => {
  const { Box, Button, Text } = kit;
  const state = fit(stateOf(call, view.now), view.columns - HEAD_PREFIX);
  // The runners view has no group header: the row names who started it.
  const tag = by === undefined ? "" : `← ${fit(oneLine(by), BY_MAX)}`;
  const room =
    view.columns -
    HEAD_PREFIX -
    state.length -
    (canStop(call) ? STOP_WIDTH : 0) -
    (tag === "" ? 0 : tag.length + 1);
  return (
    <Box flexDirection="row" gap={1}>
      <Button
        key={`row:${call.id}`}
        label={toggleLabelOf(index, view.selected === call.id)}
        {...digitOf(index)}
        {...(index === 0 && { autoFocus: true })}
        onPress={() => {
          act.select(call.id);
        }}
      />
      <Text color={COLOR[call.status]}>{GLYPH[call.status]}</Text>
      <Text dimColor={DIM.has(call.status)}>{state}</Text>
      <Text dimColor={DIM.has(call.status)} wrap="truncate-end">
        {fit(oneLine(nameOf(call)), room)}
      </Text>
      {tag !== "" && <Text dimColor>{tag}</Text>}
      {stopOf(kit, { act, stopKey }, call)}
    </Box>
  );
};

const noteRowOf = (
  kit: Readonly<Kit>,
  view: RowView,
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

const bodyOf = (
  kit: Readonly<Kit>,
  { view, fit: room }: RowContext,
  { call }: Row,
): readonly Readonly<RenderElement>[] => {
  const { Text } = kit;
  const width = view.columns - NOTE_INDENT;
  const isSelected = view.selected === call.id;
  if (!isSelected && room.isCompact) {
    return isNoteKept(call) ? noteRowOf(kit, view, call) : [];
  }
  const source = sourceOf(call);
  const details = isSelected ? tailFit(detailsOf(call), room.detailRoom) : [];
  return [
    <Text dimColor wrap="truncate-end">
      {fit(oneLine(source), width)}
    </Text>,
    ...noteRowOf(kit, view, call),
    ...details.map((line) => (
      <Text dimColor wrap="truncate-end">
        {fit(`  ${line.replaceAll("\t", "  ")}`, width)}
      </Text>
    )),
  ];
};

/**
 * One call's lines: its head, where it ran, its note, and when selected its
 * details.
 * @param kit the surface's Box, Button and Text
 * @param context the view, handlers, stop key and fit
 * @param row the call and its place
 * @returns the row
 */
export const rowOf = (
  kit: Readonly<Kit>,
  context: RowContext,
  row: Row,
): Readonly<RenderElement> => {
  const { Box } = kit;
  return (
    <Box key={`call:${row.call.id}`} flexDirection="column">
      {headRowOf(kit, context, row)}
      <Box paddingLeft={NOTE_INDENT} flexDirection="column">
        {bodyOf(kit, context, row)}
      </Box>
    </Box>
  );
};
