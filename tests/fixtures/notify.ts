import type { Engine } from "claude-code/testing";

/**
 * Appends a task-notification row as the session does. The test kit has no
 * store beneath `session.append` (its bottom never answers), so the call
 * rejects after the plugin's hook has seen the row; that rejection is ignored.
 * @param $ the test's engine
 * @param text the notification's text
 */
export const notify = async ($: Engine, text: string): Promise<void> => {
  try {
    await $.session.append({
      message: {
        type: "user",
        role: "user",
        content: [{ type: "text", text }],
      },
      door: "delivery",
      origin: { kind: "task-notification" },
      uuid: "n1",
    });
  } catch {
    // Expected: see above.
  }
};
