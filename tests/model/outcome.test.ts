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
