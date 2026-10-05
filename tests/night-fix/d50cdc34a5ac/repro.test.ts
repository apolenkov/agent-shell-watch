import { expect, test } from "claude-code/testing";

import { merged } from "../../../hooks/model/backfill.ts";
import { callOf } from "../../fixtures/call-of.ts";

test("a cleared call the state still holds does not come back", () => {
  const cleared = callOf({ id: "u1", status: "done" });
  const live = callOf({ id: "u2", status: "running" });
  const kept = merged([cleared, live], [live], {
    max: 10,
    cleared: ["u1"],
  });
  expect(kept.map((call) => call.id)).not.toContain("u1");
});
