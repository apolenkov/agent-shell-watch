/**
 * The mod's `userConfig` values, checked and defaulted.
 */
import type { PluginOptions } from "claude-code";

import type { ShellConfig } from "../../types";

const MINUTE = 60_000;
const DEFAULTS = {
  columns: 52,
  maxCalls: 50,
  quietMin: 5,
  hangMin: 10,
} as const;

/** What the hooks read from the options. */
export type Config = ShellConfig;

const positive = (
  options: PluginOptions,
  key: keyof typeof DEFAULTS,
): number => {
  const value = options[key];
  return typeof value === "number" && value > 0 ? value : DEFAULTS[key];
};

/**
 * The config from the options `register` receives.
 * @param options the plugin's `userConfig` values
 * @returns the config
 */
export const configOf = (options: PluginOptions): Config => ({
  columns: positive(options, "columns"),
  openOnStart: options["openOnStart"] === true,
  maxCalls: positive(options, "maxCalls"),
  limits: {
    quietMs: positive(options, "quietMin") * MINUTE,
    hangMs: positive(options, "hangMin") * MINUTE,
  },
  statusLine: options["statusLine"] !== false,
});
