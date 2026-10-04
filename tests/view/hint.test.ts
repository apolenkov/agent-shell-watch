import { expect, mock, test } from "claude-code/testing";

import { paneOf } from "../fixtures/pane-of.ts";
import { world } from "../fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const SURFACES = ["terminal", "desktop"] as const;

for (const surface of SURFACES) {
  test(`${surface}: unfocused, the hint says how to take the keys`, async ($, on) => {
    mock.clock(on);
    world(on);
    await $.session.start(START);
    const pane = await paneOf($, surface, {
      columns: 80,
      rows: 40,
      isFocused: false,
    });
    const found = await pane.findAll({ type: "Text" });
    expect(found.map((text) => text.text)).toContain("/shell-watch → keys");
  });
}
