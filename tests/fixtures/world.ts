import type { AgentInfo, On, SessionMessage } from "claude-code";
import { mock } from "claude-code/testing";

/** What the mocked world beneath the plugin saw and holds. */
export interface World {
  readonly statuses: (string | undefined)[];
  readonly files: Map<string, { size: number; mtimeMs: number }>;
  readonly tails: Map<string, string>;
  readonly stops: string[];
  readonly opened: string[];
  /** What `$.session.messages()` answers, by agent id ("" for the main loop). */
  readonly transcripts: Map<string, unknown[]>;
}

/**
 * Answers every engine call shell-flow makes besides Bash and the clock:
 * session start, the store, commands, status line, panes, agents, stat,
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
  mock.store(on, stored);
  const seen: World = {
    statuses: [],
    files: new Map(),
    tails: new Map(),
    stops: [],
    opened: [],
    transcripts: new Map(),
  };
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", (_$, e) => ({ value: { command: e.name } }));
  on("ui.status", (_$, e) => {
    seen.statuses.push(e.text);
    return { value: undefined };
  });
  on("ui.open", (_$, e) => {
    seen.opened.push(e.id);
    return { value: { isPlaced: true } };
  });
  on("ui.close", () => ({ value: undefined }));
  on("agent.list", () => ({ value: agents }));
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
