/**
 * The pane's tree: housekeeping buttons, then one row per call,
 * newest first, a selected row expanded to its command, tail and stderr.
 * Each row leads with a `[ ▸ ]` Button, so Tab reaches it and Enter expands.
 */
import type { Elements, RenderElement } from "claude-code";

import type { ShellAgents, ShellCall, ShellStatus } from "../../types";
import { isLive } from "../model/calls.ts";
import { GLYPH, nameOf, type Note, noteOf, stateOf } from "../model/format.ts";

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
const HOTKEYS = 9;
const HINT = "ctrl+x tab focus · 1–9 expand · c clear";

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

const cut = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;

const detailsOf = (call: ShellCall): readonly string[] => [
  `$ ${call.command}`,
  ...call.tail,
  ...call.stderr.map((line) => `stderr: ${line}`),
  ...(call.outputPath === undefined ? [] : [`output: ${call.outputPath}`]),
  ...(call.watchPath === undefined ? [] : [`watch: ${call.watchPath}`]),
];

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

const headRowOf = (
  kit: Readonly<Kit>,
  { view, act, stopKey }: Context,
  { call, index }: Row,
): Readonly<RenderElement> => {
  const { Box, Button, Text } = kit;
  return (
    <Box flexDirection="row" gap={1}>
      <Button
        key={`row:${call.id}`}
        label={view.selected === call.id ? "▾" : "▸"}
        {...digitOf(index)}
        onPress={() => {
          act.select(call.id);
        }}
      />
      <Text color={COLOR[call.status]}>{GLYPH[call.status]}</Text>
      <Text dimColor={call.status === "denied"}>{stateOf(call, view.now)}</Text>
      <Text dimColor={call.status === "denied"} wrap="truncate-end">
        {nameOf(call)}
      </Text>
      {canStop(call) && (
        <Button
          key={`stop:${call.id}`}
          label="stop"
          {...(stopKey === call.id && { hotkey: "s" })}
          onPress={() => {
            act.stop(call.taskId ?? "");
          }}
        />
      )}
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
      {cut(text, view.columns - NOTE_INDENT)}
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
  const details = context.view.selected === call.id ? detailsOf(call) : [];
  return (
    <Box key={`call:${call.id}`} flexDirection="column">
      {headRowOf(kit, context, row)}
      <Box paddingLeft={NOTE_INDENT} flexDirection="column">
        <Text dimColor wrap="truncate-end">
          {`${sourceOf(call, context.view.agents)} · ${call.command}`}
        </Text>
        {noteRowOf(kit, context.view, call)}
        {details.map((line) => (
          <Text dimColor wrap="truncate-end">{`  ${line}`}</Text>
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
  const shown = view.calls.toReversed();
  const stoppable = shown.filter(
    (call) => call.taskId !== undefined && canStop(call),
  );
  const stopKey = stoppable.length === 1 ? (stoppable[0]?.id ?? "") : "";
  const hint = [HINT, ...(stopKey === "" ? [] : ["s stop"]), "q close"];
  return (
    <Box flexDirection="column">
      {toolbarOf(kit, act)}
      {shown.length === 0 && <Text dimColor>No Bash calls yet.</Text>}
      {shown.map((call, index) =>
        rowOf(kit, { view, act, stopKey }, { call, index }),
      )}
      <Text dimColor wrap="truncate-end">
        {hint.join(" · ")}
      </Text>
    </Box>
  );
};
