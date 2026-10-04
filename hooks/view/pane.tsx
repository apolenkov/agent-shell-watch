/**
 * The pane's tree: filter and housekeeping buttons, then one row per call,
 * newest first, a selected row expanded to its command, tail and stderr.
 * Each row leads with a `[ ▸ ]` Button, so Tab reaches it and Enter expands.
 */
import type { Elements, RenderElement } from "claude-code";

import type { ShellAgents, ShellCall, ShellStatus } from "../../types";
import { isLive } from "../model/calls.ts";
import {
  agoOf,
  clockOf,
  GLYPH,
  nameOf,
  outcomeOf,
  saysOf,
} from "../model/format.ts";

/** The elements the pane draws with, on every surface that has a pane. */
export type Kit = Pick<Elements["terminal"], "Box" | "Button" | "Text">;

/** What the pane draws. */
export interface PaneView {
  readonly calls: readonly ShellCall[];
  readonly agents: ShellAgents;
  readonly now: number;
  readonly isBackgroundOnly: boolean;
  readonly selected: string;
}

/** What the pane's buttons do. */
export interface PaneActions {
  readonly toggle: () => void;
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

const headOf = (call: ShellCall, now: number): string => {
  const elapsed = clockOf((call.endedAt ?? now) - call.startedAt);
  const fresh =
    call.lastOutputAt === undefined
      ? ""
      : `output ${agoOf(now - call.lastOutputAt)} ago`;
  const right = isLive(call)
    ? [call.status === "running" ? "" : call.status, fresh]
    : [outcomeOf(call)];
  return [elapsed, nameOf(call), ...right]
    .filter((part) => part !== "")
    .join("  ");
};

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
}

const headRowOf = (
  kit: Readonly<Kit>,
  { view, act }: Context,
  call: ShellCall,
): Readonly<RenderElement> => {
  const { Box, Button, Text } = kit;
  const canStop = call.background && isLive(call) && call.taskId !== undefined;
  return (
    <Box flexDirection="row" gap={1}>
      <Button
        key={`row:${call.id}`}
        label={view.selected === call.id ? "▾" : "▸"}
        onPress={() => {
          act.select(call.id);
        }}
      />
      <Text color={COLOR[call.status]}>{GLYPH[call.status]}</Text>
      <Text dimColor={call.status === "denied"} wrap="truncate-end">
        {headOf(call, view.now)}
      </Text>
      {canStop && (
        <Button
          key={`stop:${call.id}`}
          label="stop"
          onPress={() => {
            act.stop(call.taskId ?? "");
          }}
        />
      )}
    </Box>
  );
};

const rowOf = (
  kit: Readonly<Kit>,
  context: Context,
  call: ShellCall,
): Readonly<RenderElement> => {
  const { Box, Text } = kit;
  const says =
    call.runner !== undefined && isLive(call) ? saysOf(call) : undefined;
  const details = context.view.selected === call.id ? detailsOf(call) : [];
  return (
    <Box key={`call:${call.id}`} flexDirection="column">
      {headRowOf(kit, context, call)}
      <Text dimColor wrap="truncate-end">
        {`  ${sourceOf(call, context.view.agents)} · ${call.command}`}
      </Text>
      {says !== undefined && <Text wrap="truncate-end">{`  › ${says}`}</Text>}
      {details.map((line) => (
        <Text dimColor wrap="truncate-end">{`    ${line}`}</Text>
      ))}
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
  const { Box, Button, Text } = kit;
  const shown = view.calls
    .filter((call) => !view.isBackgroundOnly || call.background)
    .toReversed();
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Button
          key="filter"
          label={view.isBackgroundOnly ? "all calls" : "background only"}
          onPress={act.toggle}
        />
        <Button key="clear" label="clear" onPress={act.clear} />
        <Button key="close" label="close" role="dismiss" onPress={act.close} />
      </Box>
      {shown.length === 0 && (
        <Text dimColor>
          {view.isBackgroundOnly
            ? "No background calls."
            : "No Bash calls yet."}
        </Text>
      )}
      {shown.map((call) => rowOf(kit, { view, act }, call))}
    </Box>
  );
};
