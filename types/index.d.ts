/** Where a call stands: live (running, quiet, hung) or settled. */
export type ShellStatus =
  "running" | "quiet" | "hung" | "done" | "failed" | "stopped";

/** An external agent CLI a Bash call runs. */
export type ShellRunner = "codex" | "pi" | "devin" | "ocr";

/** One Bash call of the session, its liveness and its outcome. */
export interface ShellCall {
  readonly id: string;
  readonly agentId?: string;
  readonly label: string;
  readonly command: string;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly exitCode?: number;
  readonly background: boolean;
  readonly taskId?: string;
  readonly outputPath?: string;
  readonly watchPath?: string;
  readonly runner?: ShellRunner;
  readonly verdict?: string;
  readonly lastOutputAt?: number;
  readonly outputBytes?: number;
  readonly tail: readonly string[];
  readonly stderr: readonly string[];
  readonly status: ShellStatus;
}

/** Subagent ids mapped to what spawned them (`type: description`). */
export type ShellAgents = Readonly<Record<string, string>>;

declare module "claude-code" {
  interface PluginState {
    "shell-flow": {
      calls: readonly ShellCall[];
      agents: ShellAgents;
      now: number;
      isOpen: boolean;
      isBackgroundOnly: boolean;
      selected: string;
    };
  }
}
