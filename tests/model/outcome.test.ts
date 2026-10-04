import { expect, test } from "claude-code/testing";

import { outcomeOf } from "../../hooks/model/outcome.ts";

test("a deny, an error and an answered record become outcomes", () => {
  expect(outcomeOf({ deny: "not allowed" })).toEqual({
    isError: false,
    text: "",
    denied: "not allowed",
  });
  expect(
    outcomeOf({ isError: true, result: "x", text: "Exit code 1\nboom" }),
  ).toEqual({ isError: true, text: "Exit code 1\nboom" });
  expect(
    outcomeOf({
      result: {
        stdout: "out",
        stderr: "err",
        interrupted: false,
        backgroundTaskId: "b1",
      },
      text: "t",
    }),
  ).toEqual({
    isError: false,
    text: "t",
    stdout: "out",
    stderr: "err",
    interrupted: false,
    backgroundTaskId: "b1",
  });
  expect(outcomeOf({ result: null })).toMatchObject({
    isError: false,
    text: "",
    stdout: "",
    interrupted: false,
  });
});

test("an aborted Bash call is an interruption, not a failure", () => {
  expect(
    outcomeOf({
      isError: true,
      result: undefined,
      text: "<error>Command was aborted before completion</error>",
    }),
  ).toEqual({
    isError: false,
    text: "<error>Command was aborted before completion</error>",
    interrupted: true,
  });
});

test("a refusal before the command ran is a denial", () => {
  for (const text of [
    "Permission to use Bash has been denied.",
    "This command requires approval",
    "Contains simple_expansion",
    "<tool_use_error>InputValidationError: command is required</tool_use_error>",
    "The user doesn't want to proceed with this tool use. The tool use was rejected",
  ]) {
    expect(outcomeOf({ isError: true, result: undefined, text })).toEqual({
      isError: false,
      text,
      denied: text,
    });
  }
  expect(
    outcomeOf({
      isError: true,
      result: undefined,
      text: "Exit code 1\nls: x: Permission denied",
    }),
  ).toEqual({ isError: true, text: "Exit code 1\nls: x: Permission denied" });
});

test("a text-only answer is the output; a text-only launch names its task", () => {
  expect(outcomeOf({ text: "a\nb" })).toMatchObject({ stdout: "a\nb" });
  expect(
    outcomeOf({
      text: "Command running in background with ID: b2. Output is being written to: /t/b2.output.",
    }),
  ).toMatchObject({ backgroundTaskId: "b2" });
  expect(
    outcomeOf({
      text: "Command was moved to the background (ID: b3). Output is being written to: /t/b3.output.",
    }),
  ).toMatchObject({ backgroundTaskId: "b3" });
});
