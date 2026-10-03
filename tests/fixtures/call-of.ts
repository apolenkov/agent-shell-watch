import type { ShellCall } from "../../types";

/**
 * A running foreground call started at 0, with the fields given over it.
 * @param over fields to set
 * @returns the call
 */
export const callOf = (over: Partial<ShellCall> = {}): ShellCall => ({
  id: "t1",
  label: "Run tests",
  command: "npm test",
  startedAt: 0,
  background: false,
  tail: [],
  stderr: [],
  status: "running",
  ...over,
});
