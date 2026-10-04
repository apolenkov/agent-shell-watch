import { expect, test } from "claude-code/testing";

import {
  classified,
  hasLive,
  isLive,
  liveOnly,
  noticed,
  polled,
  settled,
  started,
  tailed,
  trimmed,
  urgencyOrder,
} from "../../hooks/model/calls.ts";
import { callOf } from "../fixtures/call-of.ts";

const LIMITS = { quietMs: 5 * 60_000, hangMs: 10 * 60_000 };
const OK = { isError: false, text: "", stdout: "ok\n", stderr: "" };

test("a started call reads its runner and watch file from the command", () => {
  const call = started(
    {
      tool_use_id: "u1",
      command: "node w.ts --watch-file /t/c.log -- codex exec go",
      description: "Codex review",
    },
    5,
  );
  expect(call).toMatchObject({
    id: "u1",
    label: "Codex review",
    runner: "codex",
    watchPath: "/t/c.log",
    startedAt: 5,
    status: "running",
    background: false,
  });
  expect(
    started({ tool_use_id: "u2", command: "ls", agentId: "a1" }, 0),
  ).toMatchObject({ agentId: "a1", label: "ls" });
});

test("a finished foreground call is done with exit 0 and its tail", () => {
  expect(settled(callOf(), OK, 9)).toMatchObject({
    status: "done",
    exitCode: 0,
    endedAt: 9,
    tail: ["ok"],
  });
});

test("an errored call is failed with the exit code from its text", () => {
  expect(
    settled(callOf(), { isError: true, text: "Exit code 2\nbad" }, 9),
  ).toMatchObject({
    status: "failed",
    exitCode: 2,
    stderr: ["Exit code 2", "bad"],
  });
});

test("an interrupted call is stopped, a denied one denied", () => {
  expect(settled(callOf(), { ...OK, interrupted: true }, 9).status).toBe(
    "stopped",
  );
  expect(
    settled(callOf(), { isError: false, text: "", denied: "no" }, 9),
  ).toMatchObject({ status: "denied", verdict: "denied" });
  expect(isLive(callOf({ status: "denied" }))).toBe(false);
});

test("a backgrounded call keeps running with its task and output file", () => {
  const call = settled(
    callOf(),
    {
      isError: false,
      text: "Command running in background with ID: b1. Output is being written to: /t/b1.output. You will",
      backgroundTaskId: "b1",
    },
    9,
  );
  expect(call).toMatchObject({
    status: "running",
    background: true,
    taskId: "b1",
    outputPath: "/t/b1.output",
  });
  expect(call.endedAt).toBeUndefined();
});

test("a runner's verdict is its guard line", () => {
  const runner = callOf({ runner: "pi" });
  expect(
    settled(runner, { ...OK, stdout: "work\nRATE_LIMIT 1790000000\n" }, 9)
      .verdict,
  ).toBe("RATE_LIMIT 1790000000");
});

test("a notification settles the background call by task id", () => {
  const calls = [
    callOf({ background: true, taskId: "b1" }),
    callOf({ id: "t2" }),
  ];
  const after = noticed(
    calls,
    [{ taskId: "b1", status: "failed", exitCode: 3 }],
    7,
  );
  expect(after[0]).toMatchObject({ status: "failed", exitCode: 3, endedAt: 7 });
  expect(after[1]?.status).toBe("running");
  expect(
    noticed(calls, [{ taskId: "b1", status: "completed", exitCode: 0 }], 7)[0]
      ?.status,
  ).toBe("done");
  expect(
    noticed(calls, [{ taskId: "b1", status: "killed" }], 7)[0]?.status,
  ).toBe("stopped");
  const runner = [
    callOf({
      background: true,
      taskId: "b1",
      runner: "codex",
      outputPath: "/t/b1.output",
    }),
  ];
  expect(
    noticed(runner, [{ taskId: "b1", status: "completed" }], 7)[0]?.needsTail,
  ).toBe(true);
  expect(
    tailed(callOf({ runner: "codex", needsTail: true }), "DONE 0\n").needsTail,
  ).toBe(false);
});

test("liveness: running, then quiet after 5 min, hung after 10 min", () => {
  const call = callOf({ outputPath: "/t/o", lastOutputAt: 0 });
  expect(classified(call, 60_000, LIMITS).status).toBe("running");
  expect(classified(call, 6 * 60_000, LIMITS).status).toBe("quiet");
  expect(classified(call, 11 * 60_000, LIMITS).status).toBe("hung");
  expect(classified(callOf(), 11 * 60_000, LIMITS).status).toBe("running");
  expect(classified(callOf({ status: "done" }), 1e9, LIMITS).status).toBe(
    "done",
  );
});

test("a stat with new output refreshes freshness", () => {
  const call = callOf({ outputPath: "/t/o", outputBytes: 10, lastOutputAt: 0 });
  expect(polled(call, { size: 20, mtimeMs: 50 }, 60)).toMatchObject({
    outputBytes: 20,
    lastOutputAt: 50,
  });
  expect(polled(call, { size: 10, mtimeMs: 0 }, 60).lastOutputAt).toBe(0);
});

test("a tail read keeps the last 40 lines and the runner verdict", () => {
  const lines = Array.from({ length: 50 }, (_, index) => `l${String(index)}`);
  const text = [...lines, "DONE 0", ""].join("\n");
  const call = tailed(callOf({ runner: "codex" }), text);
  expect(call.tail).toHaveLength(40);
  expect(call.tail.at(-1)).toBe("DONE 0");
  expect(call.verdict).toBe("DONE 0");
  expect(tailed(callOf(), "x".repeat(500)).tail[0]).toHaveLength(200);
});

test("trimming drops the oldest finished calls first", () => {
  const calls = [
    callOf({ id: "a", status: "done" }),
    callOf({ id: "b" }),
    callOf({ id: "c", status: "failed" }),
    callOf({ id: "d", status: "done" }),
  ];
  expect(trimmed(calls, 2).map((c) => c.id)).toEqual(["b", "d"]);
  expect(trimmed(calls, 10)).toHaveLength(4);
});

test("urgency: hung, failed, quiet, running; runners first within a rank", () => {
  const calls = [
    callOf({ id: "run" }),
    callOf({ id: "quiet", status: "quiet" }),
    callOf({ id: "fail", status: "failed" }),
    callOf({ id: "hung", status: "hung" }),
    callOf({ id: "codex", runner: "codex" }),
  ];
  expect(urgencyOrder(calls).map((c) => c.id)).toEqual([
    "hung",
    "fail",
    "quiet",
    "codex",
    "run",
  ]);
  expect(isLive(callOf({ status: "quiet" }))).toBe(true);
  expect(isLive(callOf({ status: "done" }))).toBe(false);
  expect(hasLive([callOf({ status: "done" })])).toBe(false);
  expect(liveOnly(calls).map((c) => c.id)).toEqual([
    "run",
    "quiet",
    "hung",
    "codex",
  ]);
});

test("an error without an exit code fails with none invented", () => {
  const call = settled(callOf(), { isError: true, text: "boom" }, 9);
  expect(call.status).toBe("failed");
  expect(call.exitCode).toBeUndefined();
});

test("a runner's redirect is its watch file; any finished bg call is read once more", () => {
  expect(
    started({ tool_use_id: "u", command: "codex exec go > /t/c.log 2>&1" }, 0)
      .watchPath,
  ).toBe("/t/c.log");
  const bg = [callOf({ background: true, taskId: "b1", outputPath: "/t/o" })];
  expect(
    noticed(bg, [{ taskId: "b1", status: "completed", exitCode: 0 }], 7)[0]
      ?.needsTail,
  ).toBe(true);
});
