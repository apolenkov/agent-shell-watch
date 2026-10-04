/**
 * Where a call stands: live (running, quiet, hung) or settled; `denied` never
 * ran (refused by a permission rule, a hook or the person).
 */
export type ShellStatus =
  "running" | "quiet" | "hung" | "done" | "failed" | "stopped" | "denied";

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
  /** Set when a runner ended in the background: its verdict is still to read. */
  readonly needsTail?: boolean;
}

/** The mod's `userConfig` values, checked and defaulted. */
export interface ShellConfig {
  readonly columns: number;
  readonly openOnStart: boolean;
  readonly maxCalls: number;
  readonly limits: { readonly quietMs: number; readonly hangMs: number };
  readonly statusLine: boolean;
}

/** Subagent ids mapped to what spawned them (`type: description`). */
export type ShellAgents = Readonly<Record<string, string>>;

declare module "claude-code" {
  interface PluginState {
    "agent-shell-watch": {
      config: ShellConfig;
      calls: readonly ShellCall[];
      agents: ShellAgents;
      now: number;
      isOpen: boolean;
      selected: string;
      cleared: readonly string[];
    };
  }
}
