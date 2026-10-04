import type { Engine, Mounted } from "claude-code/testing";

/**
 * Mounts the shell-flow pane on a surface.
 * @param $ the test's engine
 * @param surface where it is drawn
 * @param size the body's columns and rows (80 by 40 when not given)
 * @returns the mounted drawing
 */
export const paneOf = async <S extends "terminal" | "desktop">(
  $: Engine,
  surface: S,
  size?: { columns: number; rows: number; isFocused?: boolean },
): Promise<Mounted<S, "Pane">> =>
  $.ui.mount({
    plugin: "shell-flow",
    surface,
    component: "Pane",
    requestId: "shell-flow",
    props: {
      title: "shell",
      isFocused: size?.isFocused ?? true,
      bodyColumns: size?.columns ?? 80,
      placement: "dock",
      scroll: { offset: 0, bodyRows: size?.rows ?? 40 },
      view: {},
    },
  });
