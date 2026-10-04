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

test("merging keeps the state's copies in transcript order, newest kept", () => {
  const known = [callOf({ id: "u3", label: "known" })];
  const added = merged(known, backfilled(ROWS, undefined, 0), {
    max: 3,
    cleared: [],
  });
  expect(added.map((call) => call.id)).toEqual(["u2", "u3", "u4"]);
  expect(added.find((call) => call.id === "u3")?.label).toBe("known");
  expect(
    merged(added, backfilled(ROWS, undefined, 0), { max: 3, cleared: [] }),
  ).toHaveLength(3);
});

test("a newer missed call survives the trim", () => {
  const old = callOf({ id: "old", status: "done" });
  const fresh = callOf({ id: "new", status: "done" });
  expect(
    merged([old], [old, fresh], { max: 1, cleared: [] }).map((call) => call.id),
  ).toEqual(["new"]);
});

test("cleared calls do not come back", () => {
  const rebuilt = backfilled(ROWS, undefined, 0);
  expect(
    merged([], rebuilt, { max: 10, cleared: ["u1", "u4"] }).map(
      (call) => call.id,
    ),
  ).toEqual(["u2", "u3"]);
});

test("text-only answers, TaskStop and every notification are replayed", () => {
  const rows = [
    {
      text: "",
      toolUses: [
        {
          tool_use_id: "t1",
          tool: "Bash",
          input: { command: "pi -p go" },
          text: "work\nDONE 0",
        },
        {
          tool_use_id: "t2",
          tool: "Bash",
          input: { command: "sleep 9", run_in_background: true },
          text: "Command running in background with ID: b7. Output is being written to: /t/b7.output.",
        },
        bash(
          "t3",
          { command: "sleep 8", run_in_background: true },
          {
            text: "Command was moved to the background (ID: b8). Output is being written to: /t/b8.output.",
          },
        ),
        bash(
          "t4",
          { command: "sleep 7", run_in_background: true },
          {
            text: "Command running in background with ID: b9. Output is being written to: /t/b9.output.",
          },
        ),
        {
          tool_use_id: "s1",
          tool: "TaskStop",
          input: { task_id: "b7" },
          text: "stopped",
        },
      ],
    },
    {
      text: '<task-notification><task-id>b8</task-id><status>completed</status><summary>Background command "x" completed (exit code 0)</summary></task-notification>\n<task-notification><task-id>b9</task-id><status>failed</status><summary>Background command "y" failed with exit code 4</summary></task-notification>',
      toolUses: [],
    },
  ];
  const calls = backfilled(rows, undefined, 0);
  expect(calls[0]).toMatchObject({
    status: "done",
    verdict: "DONE 0",
    tail: ["work", "DONE 0"],
  });
  expect(calls[1]).toMatchObject({
    status: "stopped",
    taskId: "b7",
    outputPath: "/t/b7.output",
  });
  expect(calls[2]).toMatchObject({ status: "done", taskId: "b8" });
  expect(calls[3]).toMatchObject({ status: "failed", exitCode: 4 });
});

test("a rebuilt call without a duration has an unknown start time", () => {
  const calls = backfilled(ROWS, undefined, 10_000);
  expect(calls[0]?.isTimeUnknown).toBeUndefined();
  expect(calls[1]?.isTimeUnknown).toBe(true);
});
