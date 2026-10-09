import type { Engine } from "claude-code/testing";

/**
 * Raises a task-notification event through the native test engine's append
 * boundary. This exercises pinned transport, not host background scheduling.
 * @param $ the test's engine
 * @param text the notification's text
 */
export const notify = async ($: Engine, text: string): Promise<void> => {
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
};
