import { expect, mock, test } from "claude-code/testing";

import { paneOf } from "./fixtures/pane-of.ts";
import { world } from "./fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const RUN = {
  command: "shell-watch",
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
    expect(seen.opened).toEqual(["shell-watch"]);
  },
);

test("a pane left open comes back open, without taking the keys", async ($, on) => {
  mock.clock(on);
  const seen = world(on, { paneOpen: true });
  await $.session.start(START);
  expect(seen.opened).toEqual(["shell-watch"]);
  expect(seen.focused).toEqual([false]);
});

test("opening is remembered; stop forgets it", async ($, on) => {
  mock.clock(on);
  const seen = world(on);
  await $.session.start(START);
  await $.command.run({ ...RUN, args: "" });
  await $.session.start(START);
  expect(seen.opened).toEqual(["shell-watch", "shell-watch"]);
  await $.command.run({ ...RUN, args: "stop" });
  await $.session.start(START);
  expect(seen.opened).toEqual(["shell-watch", "shell-watch"]);
});

test("[ close ] is remembered", async ($, on) => {
  mock.clock(on);
  const seen = world(on, { paneOpen: true });
  await $.session.start(START);
  const pane = await paneOf($, "terminal");
  await pane.press({ key: "close" });
  await $.session.start(START);
  expect(seen.opened).toEqual(["shell-watch"]);
});
