import type { Mounted } from "claude-code/testing";

/**
 * Every Text and Button label a mounted drawing shows, one per line.
 * @param ui the mounted drawing
 * @returns the text
 */
export const textOf = async (ui: Pick<Mounted, "findAll">): Promise<string> => {
  const found = [
    ...(await ui.findAll({ type: "Text" })),
    ...(await ui.findAll({ type: "Button" })),
  ];
  return found.map((element) => element.text).join("\n");
};
