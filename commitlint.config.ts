import type { UserConfig } from "@commitlint/types";

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  // Dependabot writes "chore(deps-dev): Bump ..." (scope and case outside the
  // rules below); its commits carry this trailer.
  ignores: [
    (message: string): boolean =>
      message.includes("Signed-off-by: dependabot[bot]"),
  ],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["agent-shell-watch", "repo", "deps", "ci", "main"],
    ],
  },
};

export default config;
