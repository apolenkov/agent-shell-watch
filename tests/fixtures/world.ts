import type { AgentInfo, On, SessionMessage } from "claude-code";

/** What the mocked world beneath the plugin saw and holds. */
export interface World {
  readonly statuses: (string | undefined)[];
  readonly files: Map<string, { size: number; mtimeMs: number }>;
  readonly tails: Map<string, string>;
  readonly stops: string[];
  readonly opened: string[];
  /** Whether each `$.ui.open` asked for the keyboard (`focus`). */
  readonly focused: boolean[];
  /** The `rows` each `$.ui.open` asked for (undefined when none). */
  readonly rows: (number | undefined)[];
  /** Set to make `$.agent.list()` fail. */
  isAgentListDown: boolean;
  /** What `$.store` holds: the start values, then what the plugin set. */
  readonly stored: Map<string, unknown>;
  /** What `$.session.messages()` answers, by agent id ("" for the main loop). */
  readonly transcripts: Map<string, unknown[]>;
}

/**
 * Answers every engine call agent-shell-watch makes besides Bash and the clock:
 * session start, the store (in memory, readable as `stored`), commands, status line, panes, agents, stat,
 * tail, TaskStop.
 * @param on the test's registrar
 * @param stored what `$.store` holds at the start
 * @param agents what `$.agent.list()` answers
 * @returns the world, to assert on and to feed files into
 */
export const world = (
  on: On,
  stored: Readonly<Record<string, unknown>> = {},
  agents: AgentInfo[] = [],
): World => {
  const seen: World = {
    statuses: [],
    files: new Map(),
    tails: new Map(),
    stops: [],
    opened: [],
    focused: [],
    rows: [],
    isAgentListDown: false,
    transcripts: new Map(),
    stored: new Map(Object.entries(stored)),
  };
  on("store.get", (_$, e) => ({ value: seen.stored.get(e.key) }));
  on("store.set", (_$, e) => {
    seen.stored.set(e.key, e.value);
    return { value: undefined };
  });
  on("store.delete", (_$, e) => {
    seen.stored.delete(e.key);
    return { value: undefined };
  });
  on("store.keys", () => ({ value: [...seen.stored].map(([key]) => key) }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", (_$, e) => ({ value: { command: e.name } }));
  on("ui.status", (_$, e) => {
    seen.statuses.push(e.text);
    return { value: undefined };
  });
  on("ui.open", (_$, e) => {
    seen.opened.push(e.id);
    seen.focused.push(e.focus === true);
    seen.rows.push(e.rows);
    return { value: { isPlaced: true } };
  });
  on("ui.close", () => ({ value: undefined }));
  on("agent.list", () => {
    if (seen.isAgentListDown) {
      throw new Error("agent list unavailable");
    }
    return { value: agents };
  });
  on("session.messages", (_$, e) => ({
    value: (seen.transcripts.get(e.agentId ?? "") ?? []) as SessionMessage[],
  }));
  on("fs.stat", (_$, e) => {
    const file = seen.files.get(e.path);
    if (file === undefined) {
      throw new Error(`ENOENT: ${e.path}`);
    }
    return { value: { kind: "file", isLink: false, ...file } };
  });
  on("process.run", (_$, e) => ({
    value: {
      exitCode: 0,
      stdout: seen.tails.get(e.argv.at(-1) ?? "") ?? "",
      stderr: "",
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }));
  on("tool.call", { tool: "TaskStop" }, (_$, e) => {
    seen.stops.push(e.task_id ?? "");
    return {
      result: {
        message: "stopped",
        task_id: e.task_id ?? "",
        task_type: "bash",
      },
    };
  });
  return seen;
};
