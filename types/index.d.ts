/**
 * Where a call stands: live (running, quiet, hung) or settled; `denied` never
 * ran (refused by a permission rule, a hook or the person).
 */
export type ShellStatus =
  | "running"
  | "quiet"
  | "hung"
  | "done"
  | "failed"
  | "stopped"
  | "denied"
  | "nomatch";

/** An external agent CLI a Bash call runs. */
export type ShellRunner = "codex" | "pi" | "devin" | "ocr";

/**
 * What the mod watches: only delegated agent runs (`runners`), or every Bash
 * call and background task (`all`).
 */
export type ShellScope = "runners" | "all";

/** What the pane lists: every call by agent, or only the external runners. */
export type ShellView = "agents" | "runners";

/** The executors whose subscription limits the runners view shows. */
export type LimitName = "devin" | "pi" | "codex";

/** One executor's limit: blocked until a time (ms), Codex's window use (%). */
export interface ExecutorLimit {
  readonly blockedUntil?: number;
  readonly percent?: number;
}

/** What the last limits read found; `readAt` (ms) absent before the first. */
export interface ShellLimits {
  readonly readAt?: number;
  readonly by: Readonly<Record<LimitName, ExecutorLimit>>;
}

/**
 * What a runner call's session file said: tokens (Pi's `totalTokens`, Codex's
 * `total_tokens`, cached input included), Pi's cost in dollars, `isPartial`
 * when only the end of a larger file was summed; `readAt` (ms) throttles reads.
 */
export interface CallUsage {
  readonly tokens?: number;
  readonly cost?: number;
  readonly isPartial?: boolean;
  readonly readAt: number;
}

/** Call ids mapped to what their runner's session file said. */
export type ShellUsage = Readonly<Record<string, CallUsage>>;

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
  /** Rebuilt from a transcript with no duration: when it started is unknown. */
  readonly isTimeUnknown?: boolean;
}

/** The mod's `userConfig` values, checked and defaulted. */
export interface ShellConfig {
  readonly columns: number;
  readonly openOnStart: boolean;
  readonly maxCalls: number;
  readonly limits: { readonly quietMs: number; readonly hangMs: number };
  readonly statusLine: boolean;
  readonly scope: ShellScope;
}

/** What `$.agent.list()` said of one subagent. */
export interface ShellAgentInfo {
  readonly type: string;
  readonly description: string;
  readonly status: string;
  readonly parentId?: string;
}

/** Subagent ids mapped to what `$.agent.list()` said of them. */
export type ShellAgents = Readonly<Record<string, ShellAgentInfo>>;

declare module "claude-code" {
  interface PluginState {
    "agent-shell-watch": {
      config: ShellConfig;
      calls: readonly ShellCall[];
      agentInfo: ShellAgents;
      folds: Readonly<Record<string, boolean>>;
      view: ShellView;
      limits: ShellLimits;
      usage: ShellUsage;
      now: number;
      look: number;
      isOpen: boolean;
      selected: string;
      cleared: readonly string[];
    };
  }
}
