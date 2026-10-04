import type { UserConfig } from "@commitlint/types";

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["agent-shell-watch", "repo", "deps", "ci", "main"],
    ],
  },
};

export default config;
