/**
 * shell-flow: an always-on status line and a pane for this session's Bash
 * calls, background tasks and runner (Codex, Pi, Devin, OpenCodeReview) runs.
 * Every hook observes and passes its event on unchanged. The poller lives
 * here: the engine follows `$` only into functions of the same file.
 */
import type { EngineInterface, Register } from "claude-code";
import { atom, read, update } from "claude-code";

import type { ShellCall } from "../types";
import { classified, hasLive, polled, tailed } from "./model/calls.ts";
import { type Config, configOf } from "./model/config.ts";
import { statusLineOf } from "./model/format.ts";
import { isTailDue, tailPathOf, watchedOf } from "./model/poll.ts";
import { onRender } from "./pane.tsx";
import { onClose, onCommand, PANE } from "./slash-command.ts";
import { onAppend, onToolCall } from "./track.ts";

const NO_CALLS: readonly ShellCall[] = [];
const callsAtom = atom(
  { plugin: "shell-flow", key: "calls" } as const,
  NO_CALLS,
);
const configAtom = atom(
  { plugin: "shell-flow", key: "config" } as const,
  configOf({}),
);
const nowAtom = atom({ plugin: "shell-flow", key: "now" } as const, 0);
const openAtom = atom({ plugin: "shell-flow", key: "isOpen" } as const, false);
const selectedAtom = atom(
  { plugin: "shell-flow", key: "selected" } as const,
  "",
);

const TICK_MS = 1000;
const POLL_MS = 2000;
const TAIL_LINES = "40";

type Engine = Readonly<EngineInterface>;

const tick = async ($: Engine, config: Config): Promise<void> => {
  const now = await $.clock.now();
  const calls = await read($, callsAtom);
  if (hasLive(calls)) {
    await update($, nowAtom, () => now);
  }
  $.ui.status(config.statusLine ? statusLineOf(calls, now) : undefined);
};

const tailOf = async ($: Engine, path: string): Promise<string | undefined> => {
  try {
    const ran = await $.process.run(["tail", "-n", TAIL_LINES, path]);
    return ran.exitCode === 0 ? ran.stdout : undefined;
  } catch {
    return;
  }
};

const statOf = async (
  $: Engine,
  path: string,
): Promise<{ size: number; mtimeMs: number } | undefined> => {
  try {
    return await $.fs.stat(path);
  } catch {
    // A runner's watch file may not exist yet: silence, not failure.
    return;
  }
};

const pollCall = async (
  $: Engine,
  call: ShellCall,
  isTailWanted: boolean,
): Promise<void> => {
  const stat = await statOf($, call.watchPath ?? call.outputPath ?? "");
  const isNew = stat !== undefined && stat.size !== call.outputBytes;
  const text = isTailDue(call, { isNew, isWanted: isTailWanted })
    ? await tailOf($, tailPathOf(call) ?? "")
    : undefined;
  const now = await $.clock.now();
  await update($, callsAtom, (calls) =>
    calls.map((one) => {
      const fresh =
        stat !== undefined && one.id === call.id ? polled(one, stat, now) : one;
      return text !== undefined && one.id === call.id
        ? tailed(fresh, text)
        : fresh;
    }),
  );
};

const poll = async ($: Engine, config: Config): Promise<void> => {
  const isOpen = await read($, openAtom);
  const selected = await read($, selectedAtom);
  const calls = await read($, callsAtom);
  const watched = watchedOf(calls);
  await Promise.all(
    watched.map(async (call) =>
      pollCall(
        $,
        call,
        call.runner !== undefined || (isOpen && selected === call.id),
      ),
    ),
  );
  const now = await $.clock.now();
  await update($, callsAtom, (calls) =>
    calls.map((call) => classified(call, now, config.limits)),
  );
};

/**
 * Wires shell-flow's hooks.
 * @param on the registrar
 * @param options the `userConfig` values
 */
export const register: Register = (on, options) => {
  const config = configOf(options);
  // session.start fires again on a hot reload, which dropped the timers:
  // the poller restarts here and picks up the calls the state still holds.
  on("session.start", async ($, e, next) => {
    const started = await next(e);
    await update($, configAtom, () => config);
    await $.command.register({
      name: PANE,
      description:
        "Live Bash calls, background tasks and runner runs (clear|stop)",
      argumentHint: "[clear|stop]",
      immediate: true,
    });
    $.clock.every(TICK_MS, () => {
      void tick($, config);
    });
    $.clock.every(POLL_MS, () => {
      void poll($, config);
    });
    if (config.openOnStart) {
      await $.ui.open({ id: PANE, title: "shell", columns: config.columns });
      await update($, openAtom, () => true);
    }
    return started;
  });
  on("tool.call", onToolCall);
  on("session.append", onAppend);
  on("command.run", { command: "shell-flow" }, onCommand);
  on("ui.close", onClose);
  on("ui.render", { component: "Pane", requestId: "shell-flow" }, onRender);
};
