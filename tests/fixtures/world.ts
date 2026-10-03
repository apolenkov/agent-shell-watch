import type { AgentInfo, On } from "claude-code";

/** What the mocked world beneath the plugin saw and holds. */
export interface World {
  readonly statuses: (string | undefined)[];
  readonly files: Map<string, { size: number; mtimeMs: number }>;
  readonly tails: Map<string, string>;
  readonly stops: string[];
  readonly opened: string[];
}

/**
 * Answers every engine call shell-flow makes besides Bash and the clock:
 * session start, commands, status line, panes, agents, stat, tail, TaskStop.
 * @param on the test's registrar
 * @param agents what `$.agent.list()` answers
 * @returns the world, to assert on and to feed files into
 */
export const world = (on: On, agents: AgentInfo[] = []): World => {
  const seen: World = {
    statuses: [],
    files: new Map(),
    tails: new Map(),
    stops: [],
    opened: [],
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
