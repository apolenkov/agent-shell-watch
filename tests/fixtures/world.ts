import type { AgentInfo, FsEntry, On, SessionMessage } from "claude-code";
import { mock, type MockSession } from "claude-code/testing";

/** What the mocked world beneath the plugin saw and holds. */
export interface World {
  /** Native test-kit storage for append transport and its downstream receipt. */
  readonly session: MockSession;
  readonly statuses: (string | undefined)[];
  readonly files: Map<string, { size: number; mtimeMs: number }>;
  readonly tails: Map<string, string>;
  readonly stops: string[];
  readonly opened: string[];
  /** Whether each `$.ui.open` asked for the keyboard (`focus`). */
  readonly focused: boolean[];
  /** The `rows` each `$.ui.open` asked for (undefined when none). */
  readonly rows: (number | undefined)[];
  /** What `$.fs.read` answers by path; a path not in it is missing. */
  readonly texts: Map<string, string>;
  /**
   * What `$.fs.list` answers by directory; one not in it is missing. Entries
   * hold the real size and mtime: the mock lists 0 for any but a file, and
   * `$.fs.stat` answers with the real ones.
   */
  readonly listings: Map<string, FsEntry[]>;
  /** Every path `$.fs.read` was asked for, in order. */
  readonly reads: string[];
  /** Every argument vector `$.process.run` was given, in order. */
  readonly runs: (readonly string[])[];
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
    session: mock.session(on),
    statuses: [],
    files: new Map(),
    tails: new Map(),
    stops: [],
    opened: [],
    focused: [],
    rows: [],
    isAgentListDown: false,
    transcripts: new Map(),
    texts: new Map(),
    listings: new Map(),
    reads: [],
    runs: [],
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
    if (file !== undefined) {
      return { value: { kind: "file", isLink: false, ...file } };
    }
    // What a listing holds under that path, with its real size and mtime.
    const slash = e.path.lastIndexOf("/");
    const listed = seen.listings
      .get(e.path.slice(0, slash))
      ?.find((entry) => entry.name === e.path.slice(slash + 1));
    if (listed === undefined) {
      throw new Error(`ENOENT: ${e.path}`);
    }
    return { value: listed };
  });
  mock.env(on, { HOME: "/home/t" });
  on("fs.read", (_$, e) => {
    seen.reads.push(e.path);
    const text = seen.texts.get(e.path);
    if (text === undefined) {
      throw new Error(`ENOENT: ${e.path}`);
    }
    return { value: text };
  });
  on("fs.list", (_$, e) => {
    const entries = seen.listings.get(e.path);
    if (entries === undefined) {
      throw new Error(`ENOENT: ${e.path}`);
    }
    // As the engine answers: size and mtimeMs are 0 for anything but a
    // regular file; `$.fs.stat` has the real ones.
    return {
      value: entries.map((entry) =>
        entry.kind === "file" ? entry : { ...entry, size: 0, mtimeMs: 0 },
      ),
    };
  });
  on("process.run", (_$, e) => {
    seen.runs.push(e.argv);
    return {
      value: {
        exitCode: 0,
        stdout: seen.tails.get(e.argv.at(-1) ?? "") ?? "",
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
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
