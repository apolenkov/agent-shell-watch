import { expect, test } from "claude-code/testing";

import {
  backfilled,
  merged,
  type ToolUseRow,
} from "../../hooks/model/backfill.ts";
import { callOf } from "../fixtures/call-of.ts";

const bash = (
  id: string,
  input: Record<string, unknown>,
  answer: Partial<ToolUseRow> = {},
): ToolUseRow => ({ tool_use_id: id, tool: "Bash", input, ...answer });

const ROWS = [
  {
    role: "assistant" as const,
    text: "",
    toolUses: [
      bash(
        "u1",
        { command: "ls", description: "List" },
        {
          result: { stdout: "a\n", stderr: "", interrupted: false },
          text: "a",
          durationMs: 2000,
        },
      ),
      bash(
        "u2",
        { command: "npm run e2e", description: "E2E", run_in_background: true },
        {
          result: {
            stdout: "",
            stderr: "",
            interrupted: false,
            backgroundTaskId: "b2",
          },
          text: "Command running in background with ID: b2. Output is being written to: /t/b2.output.",
        },
      ),
      bash(
        "u3",
        { command: "sleep 99", description: "Wait", run_in_background: true },
        {
          result: {
            stdout: "",
            stderr: "",
            interrupted: false,
            backgroundTaskId: "b3",
          },
          text: "Command running in background with ID: b3. Output is being written to: /t/b3.output.",
        },
      ),
      bash(
        "u4",
        { command: "tsc" },
        { isError: true, text: "Exit code 2\nboom" },
      ),
      bash("u5", { command: "make" }),
      {
        tool_use_id: "r1",
        tool: "Read",
        input: { file_path: "/x" },
        text: "x",
      },
    ],
  },
  {
    role: "user" as const,
    text: '<task-notification>\n<task-id>b2</task-id>\n<status>completed</status>\n<summary>Background command "x" completed (exit code 0)</summary>\n</task-notification>',
    toolUses: [],
  },
];

test("Bash calls are rebuilt from the transcript, finished or still running", () => {
  const calls = backfilled(ROWS, undefined, 10_000);
  expect(calls.map((call) => [call.id, call.status])).toEqual([
    ["u1", "done"],
    ["u2", "done"],
    ["u3", "running"],
    ["u4", "failed"],
  ]);
  expect(calls[0]).toMatchObject({
    label: "List",
    exitCode: 0,
    startedAt: 8000,
  });
  expect(calls[2]).toMatchObject({
    background: true,
    taskId: "b3",
    outputPath: "/t/b3.output",
  });
  expect(calls[3]?.exitCode).toBe(2);
  expect(backfilled(ROWS, "a1", 10_000)[0]?.agentId).toBe("a1");
});

test("merging keeps what the state holds and adds the rest, newest kept", () => {
  const known = [callOf({ id: "u3", label: "known" })];
  const added = merged(known, backfilled(ROWS, undefined, 0), 3);
  expect(added.map((call) => call.id)).toEqual(["u2", "u4", "u3"]);
  expect(added.find((call) => call.id === "u3")?.label).toBe("known");
  expect(merged(added, backfilled(ROWS, undefined, 0), 3)).toHaveLength(3);
});
