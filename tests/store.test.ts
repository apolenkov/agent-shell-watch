import { expect, mock, test } from "claude-code/testing";

import { paneOf } from "./fixtures/pane-of.ts";
import { world } from "./fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const RUN = {
  command: "shell-flow",
  origin: { kind: "composer" },
  presentation: { isFullscreen: true, columns: 160 },
} as const;

test(
  "a pane left closed stays closed, whatever openOnStart says",
  { options: { openOnStart: true } },
  async ($, on) => {
    mock.clock(on);
    const seen = world(on, { paneOpen: false });
    await $.session.start(START);
    expect(seen.opened).toEqual([]);
  },
);

test(
  "nothing stored: openOnStart decides",
  { options: { openOnStart: true } },
  async ($, on) => {
    mock.clock(on);
    const seen = world(on);
    await $.session.start(START);
    expect(seen.opened).toEqual(["shell-flow"]);
  },
);

test("a pane left open with its filter on comes back so", async ($, on) => {
  mock.clock(on);
  const seen = world(on, { paneOpen: true, backgroundOnly: true });
  await $.session.start(START);
  expect(seen.opened).toEqual(["shell-flow"]);
  const pane = await paneOf($, "terminal");
  const filter = await pane.find({ key: "filter" });
  expect(filter?.text).toBe("all calls");
});

test("opening and filtering are remembered; stop forgets the open pane", async ($, on) => {
  mock.clock(on);
  const seen = world(on);
  await $.session.start(START);
  await $.command.run({ ...RUN, args: "" });
  const pane = await paneOf($, "terminal");
  await pane.press({ key: "filter" });
  await $.session.start(START);
  expect(seen.opened).toEqual(["shell-flow", "shell-flow"]);
  await $.command.run({ ...RUN, args: "stop" });
  await $.session.start(START);
  expect(seen.opened).toEqual(["shell-flow", "shell-flow"]);
  const filter = await pane.find({ key: "filter" });
  expect(filter?.text).toBe("all calls");
});

test("[ close ] is remembered", async ($, on) => {
  mock.clock(on);
  const seen = world(on, { paneOpen: true });
  await $.session.start(START);
  const pane = await paneOf($, "terminal");
  await pane.press({ key: "close" });
  await $.session.start(START);
  expect(seen.opened).toEqual(["shell-flow"]);
});
