/**
 * What the poller looks at: which calls to stat, and when to read a tail.
 */
import type { ShellCall } from "../../types";
import { isLive } from "./calls.ts";

/** Whether a stat saw new output, and whether the call's tail is wanted. */
export interface TailNeed {
  readonly isNew: boolean;
  readonly isWanted: boolean;
}

/**
 * The calls the poller stats: live ones with an output or watch file, and
 * runners whose verdict is still to be read.
 * @param calls the list
 * @returns the calls to poll
 */
export const watchedOf = (calls: readonly ShellCall[]): readonly ShellCall[] =>
  calls.filter(
    (call) =>
      call.needsTail === true ||
      (isLive(call) &&
        (call.watchPath !== undefined || call.outputPath !== undefined)),
  );

/**
 * Which file's tail to read: live progress from the watch file, else the
 * Bash output; once finished, the output (where the guard's verdict is).
 * @param call the call
 * @returns the path, or undefined when there is none
 */
export const tailPathOf = (call: ShellCall): string | undefined =>
  call.needsTail === true
    ? (call.outputPath ?? call.watchPath)
    : (call.watchPath ?? call.outputPath);

/**
 * Whether to read the call's output tail now.
 * @param call the call
 * @param need what the stat saw and whether the tail is wanted
 * @returns true when the tail should be read
 */
export const isTailDue = (call: ShellCall, need: TailNeed): boolean =>
  tailPathOf(call) !== undefined &&
  (call.needsTail === true || (need.isNew && need.isWanted));
