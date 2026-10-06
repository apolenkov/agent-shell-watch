import type { AgentInfo } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

import { advance } from "./fixtures/advance.ts";
import { labelOf } from "./fixtures/label-of.ts";
import { paneOf } from "./fixtures/pane-of.ts";
import { world } from "./fixtures/world.ts";

const START = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
// These tests group plain calls under their agents: they need scope: all.
const ALL = { options: { scope: "all" } } as const;

const subagentCall = {
  role: "assistant",
  text: "",
  toolUses: [
    {
      tool_use_id: "d1",
      tool: "Bash",
      input: { command: "ls", description: "List" },
      result: { stdout: "ok\n", stderr: "", interrupted: false },
      text: "ok",
      durationMs: 1000,
    },
  ],
};

test(
  "the poller follows an agent's status; a failing list keeps the last",
  ALL,
  async ($, on) => {
    const clock = mock.clock(on);
    const agents: AgentInfo[] = [
      { id: "a1", type: "Explore", description: "Find", status: "running" },
    ];
    const seen = world(on, {}, agents);
    seen.transcripts.set("a1", [subagentCall]);
    await $.session.start(START);
    const pane = await paneOf($, "terminal");
    const glyphOf = async (): Promise<string | undefined> => {
      const texts = await pane.findAll({ type: "Text" });
      const at = texts.findIndex((text) => text.text === "Explore: Find");
      return texts[at - 1]?.text;
    };
    expect(await glyphOf()).toBe("◌");

    agents[0] = {
      id: "a1",
      type: "Explore",
      description: "Find",
      status: "failed",
    };
    await advance(clock, 2000);
    expect(await glyphOf()).toBe("✗");

    seen.isAgentListDown = true;
    agents[0] = {
      id: "a1",
      type: "Explore",
      description: "Find",
      status: "completed",
    };
    await advance(clock, 2000);
    expect(await glyphOf()).toBe("✗");

    seen.isAgentListDown = false;
    await advance(clock, 2000);
    expect(await glyphOf()).toBe("●");
  },
);

test(
  "f folds every group, then opens them; a new group gets its default",
  ALL,
  async ($, on) => {
    mock.clock(on);
    const agents: AgentInfo[] = [
      { id: "a1", type: "Explore", description: "Find", status: "running" },
    ];
    const seen = world(on, {}, agents);
    seen.transcripts.set("a1", [subagentCall]);
    on("tool.call", { tool: "Bash" }, () => ({
      result: { stdout: "ok\n", stderr: "", interrupted: false },
      text: "ok",
    }));
    await $.session.start(START);
    const pane = await paneOf($, "terminal");
    await pane.press({ key: "fold" });
    expect(await labelOf(pane, "group:a1")).toBe("1 ▸");
    await $.tool.call({ tool: "Bash", command: "pwd", description: "Where" });
    // main, new, starts idle: open by default although the rest are folded.
    expect(await labelOf(pane, "group:main")).toBe("1 ▾");
  },
);

test(
  "opening a group asks the pane for the rows it now needs",
  ALL,
  async ($, on) => {
    const clock = mock.clock(on);
    const agents: AgentInfo[] = [
      { id: "a1", type: "Explore", description: "Find", status: "running" },
    ];
    const seen = world(on, {}, agents);
    const [use] = subagentCall.toolUses;
    seen.transcripts.set("a1", [
      {
        ...subagentCall,
        toolUses: [use, { ...use, tool_use_id: "d2" }],
      },
    ]);
    await $.session.start(START);
    agents[0] = {
      id: "a1",
      type: "Explore",
      description: "Find",
      status: "completed",
    };
    await advance(clock, 2000);
    await $.command.run({
      command: "shell-watch",
      args: "",
      origin: { kind: "composer" },
      presentation: { isFullscreen: false, columns: 120 },
    });
    const pane = await paneOf($, "terminal");
    expect(await labelOf(pane, "group:a1")).toBe("1 ▸");
    await pane.press({ key: "group:a1" });
    expect(await labelOf(pane, "group:a1")).toBe("1 ▾");
    // chrome 2 + header 1 + two rows: head, command, last line 3 each
    expect(seen.rows).toEqual([6, 9]);
  },
);
