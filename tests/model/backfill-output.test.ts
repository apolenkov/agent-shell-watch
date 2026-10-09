import { expect, test } from "claude-code/testing";

import { backfilled } from "../../hooks/model/backfill.ts";

const CASES = [
  {
    name: "blank stored bulk uses available guard-bearing text",
    answer: { result: { stdout: "" }, text: "work\nDONE 0" },
    tail: ["work", "DONE 0"],
    verdict: "DONE 0",
  },
  {
    name: "unavailable stored stdout uses available text",
    answer: { result: {}, text: "work\nDONE 0" },
    tail: ["work", "DONE 0"],
    verdict: "DONE 0",
  },
  {
    name: "absent stored result uses available text",
    answer: { text: "work\nDONE 0" },
    tail: ["work", "DONE 0"],
    verdict: "DONE 0",
  },
  {
    name: "nonempty structured stdout takes precedence over the summary",
    answer: { result: { stdout: "raw\nDONE 0" }, text: "summary" },
    tail: ["raw", "DONE 0"],
    verdict: "DONE 0",
  },
  {
    name: "a summary without a final guard supplies no verdict",
    answer: { result: { stdout: "" }, text: "review completed" },
    tail: ["review completed"],
    verdict: undefined,
  },
  {
    name: "a guard followed by ordinary summary text supplies no verdict",
    answer: { result: { stdout: "" }, text: "DONE 0\nmore context" },
    tail: ["DONE 0", "more context"],
    verdict: undefined,
  },
  {
    name: "an empty stored stdout without text remains empty",
    answer: { result: { stdout: "" } },
    tail: [],
    verdict: undefined,
  },
  {
    name: "an unavailable stored stdout without text remains empty",
    answer: { result: {} },
    tail: [],
    verdict: undefined,
  },
] as const;

for (const { name, answer, tail, verdict } of CASES) {
  test(`replay output: ${name}`, () => {
    const [call] = backfilled(
      [
        {
          text: "",
          toolUses: [
            {
              tool_use_id: "u1",
              tool: "Bash",
              input: { command: "pi -p go" },
              ...answer,
            },
          ],
        },
      ],
      undefined,
      10,
    );
    expect(call).toMatchObject({ status: "done", exitCode: 0, tail });
    expect(call?.verdict).toBe(verdict);
  });
}
