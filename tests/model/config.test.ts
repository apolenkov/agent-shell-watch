import { expect, test } from "claude-code/testing";

import { configOf } from "../../hooks/model/config.ts";

test("options become the config, minutes as ms, bad values defaulted", () => {
  expect(
    configOf({
      columns: 60,
      openOnStart: true,
      maxCalls: 10,
      quietMin: 1,
      hangMin: 2,
      statusLine: false,
    }),
  ).toEqual({
    columns: 60,
    openOnStart: true,
    maxCalls: 10,
    limits: { quietMs: 60_000, hangMs: 120_000 },
    statusLine: false,
  });
  expect(configOf({ columns: "wide", maxCalls: -3 })).toEqual({
    columns: 52,
    openOnStart: false,
    maxCalls: 50,
    limits: { quietMs: 300_000, hangMs: 600_000 },
    statusLine: true,
  });
});
