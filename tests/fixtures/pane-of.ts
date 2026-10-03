import type { Engine, Mounted } from "claude-code/testing";

/**
 * Mounts the shell-flow pane on a surface.
 * @param $ the test's engine
 * @param surface where it is drawn
 * @returns the mounted drawing
 */
export const paneOf = async <S extends "terminal" | "desktop">(
  $: Engine,
  surface: S,
): Promise<Mounted<S, "Pane">> =>
  $.ui.mount({
    plugin: "shell-flow",
    surface,
    component: "Pane",
    requestId: "shell-flow",
    props: {
      title: "shell",
      isFocused: true,
      bodyColumns: 80,
      placement: "dock",
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  });
