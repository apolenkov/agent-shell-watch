import type { UserConfig } from "@commitlint/types";

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["shell-flow", "council", "repo", "deps", "ci"],
    ],
  },
};

export default config;
