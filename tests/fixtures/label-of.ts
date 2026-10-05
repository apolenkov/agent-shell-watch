import type { Mounted } from "claude-code/testing";

/**
 * The shown text (a Button's label) of the element keyed `key`.
 * @param ui the mounted drawing
 * @param key the element's key
 * @returns its text, or undefined when it is not drawn
 */
export const labelOf = async (
  ui: Pick<Mounted, "find">,
  key: string,
): Promise<string | undefined> => {
  const found = await ui.find({ key });
  return found?.text;
};
