/**
 * Reads the machine files the mod does not own (a rollout's lines): their
 * format is the tool's, so text that is not JSON is an answer, not an error.
 */

/**
 * `JSON.parse` that never throws.
 * @param text one JSON document
 * @returns the value, or undefined when the text is not JSON
 */
export const parsedOf = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};
