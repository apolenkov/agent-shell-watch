import type { AgentInfo } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

import { labelOf } from "../fixtures/label-of.ts";
import { paneOf } from "../fixtures/pane-of.ts";
import { world } from "../fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const AGENTS: AgentInfo[] = [
  {
    id: "a1",
    type: "general-purpose",
    description: "Review spec",
    status: "running",
  },
];
const BG_TEXT =
  "Command running in background with ID: b1. Output is being written to: /t/b1.output. You will be notified.";

for (const surface of ["terminal", "desktop"] as const) {
  test(`${surface}: calls group under their owner, with folds and one index`, async ($, on) => {
    mock.clock(on);
    const seen = world(on, {}, AGENTS);
    seen.files.set("/t/b1.output", { size: 1, mtimeMs: 0 });
    // A subagent's call reaches the mod through its transcript (a test's
    // $.tool.call cannot carry an agentId).
    seen.transcripts.set("a1", [
      {
        role: "assistant",
        text: "",
        toolUses: [
          {
            tool_use_id: "d1",
            tool: "Bash",
            input: {
              command: "devin -p 'review the spec'",
              description: "Review",
            },
            isError: true,
            text: "Exit code 1\nRATE_LIMIT 1790000000",
            durationMs: 3000,
          },
        ],
      },
    ]);
    on("tool.call", { tool: "Bash" }, (_$, e) =>
      e.run_in_background === true
        ? {
            result: {
              stdout: "",
              stderr: "",
              interrupted: false,
              backgroundTaskId: "b1",
            },
            text: BG_TEXT,
          }
        : {
            result: { stdout: "ok\n", stderr: "", interrupted: false },
            text: "ok",
          },
    );
    await $.session.start(START);
    await $.tool.call({
      tool: "Bash",
      command: "sleep 600",
      description: "Wait",
      run_in_background: true,
    });
    await $.tool.call({ tool: "Bash", command: "ls", description: "List" });

    const pane = await paneOf($, surface, { columns: 100, rows: 30 });
    const texts = async (): Promise<readonly string[]> => {
      const found = await pane.findAll({ type: "Text" });
      return found.map((text) => text.text);
    };
    const buttons = async (): Promise<readonly (string | undefined)[]> => {
      const found = await pane.findAll({ type: "Button" });
      return found.map((button) => button.key);
    };

    const drawn = await texts();
    expect(drawn).toContain("general-purpose: Review spec");
    expect(drawn).toContain("main");
    expect(drawn.indexOf("general-purpose: Review spec")).toBeLessThan(
      drawn.indexOf("main"),
    );
    expect(drawn).toContain("bg · sleep 600");
    expect(drawn).toContain("ls");
    expect(drawn.some((text) => text.includes("main · ls"))).toBe(false);
    expect(drawn).toContain(
      "1–9 open · f fold · c clear · q close · Esc → prompt",
    );

    const keys = await buttons();
    expect(keys.filter((key) => key?.startsWith("group:") === true)).toEqual([
      "group:a1",
      "group:main",
    ]);
    const header = await pane.find({ key: "group:a1" });
    expect(header?.text).toBe("1 ▾");
    expect(header?.props["hotkey"]).toBe("1");

    await pane.press({ key: "group:a1" });
    const folded = await texts();
    expect(folded.some((text) => text.includes("devin -p"))).toBe(false);
    expect(await labelOf(pane, "group:a1")).toBe("1 ▸");
    expect(await labelOf(pane, "group:main")).toBe("2 ▾");

    await pane.press({ key: "fold" });
    expect(await labelOf(pane, "group:main")).toBe("2 ▸");
    await pane.press({ key: "fold" });
    expect(await labelOf(pane, "group:main")).toBe("3 ▾");
  });
}
