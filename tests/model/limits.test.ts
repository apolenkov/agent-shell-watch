import { expect, test } from "claude-code/testing";

import {
  blockedOf,
  codexLimitOf,
  isLimitsDue,
  limitFileOf,
  limitPathOf,
  limitsLineOf,
  limitsOf,
  limitTimeOf,
  newestRolloutOf,
  NO_LIMITS,
  sessionDirectoriesOf,
} from "../../hooks/model/limits.ts";
import type { ShellLimits } from "../../types";
import { callOf } from "../fixtures/call-of.ts";
import {
  LIMIT_FILE,
  TOKEN_COUNT_FULL,
  TOKEN_COUNT_NO_PRIMARY,
} from "../fixtures/limits.ts";

const FILE_AT = 1_791_142_352_000;
const RESETS_AT = 1_791_640_084_000;
const BEFORE_FILE = FILE_AT - 60_000;
const BETWEEN = FILE_AT + 60_000;
const AFTER_RESETS = RESETS_AT + 60_000;
const HOUR = 3_600_000;

test("a limits file with a future epoch blocks until then", () => {
  expect(limitFileOf(LIMIT_FILE, BEFORE_FILE)).toBe(FILE_AT);
});

test("a limits file with a past epoch reads as ok", () => {
  expect(limitFileOf(LIMIT_FILE, BETWEEN)).toBeUndefined();
  expect(limitFileOf(LIMIT_FILE, FILE_AT)).toBeUndefined();
});

test("a damaged or empty limits file reads as ok", () => {
  for (const text of ["", "\n", "soon", "17911x", "-5", "1.5e9", "{}", "0"]) {
    expect(limitFileOf(text, 0)).toBeUndefined();
  }
});

test("Codex: 100% with a reset ahead blocks until the reset", () => {
  expect(codexLimitOf(TOKEN_COUNT_FULL, BETWEEN)).toEqual({
    blockedUntil: RESETS_AT,
    percent: 100,
  });
});

test("Codex: 100% whose reset has passed is ok, and its percent is stale", () => {
  expect(codexLimitOf(TOKEN_COUNT_FULL, AFTER_RESETS)).toEqual({});
});

test("Codex: under 100% is ok and carries the percent", () => {
  const some = TOKEN_COUNT_FULL.replace(
    '"used_percent":100.0',
    '"used_percent":99.6',
  );
  expect(some).not.toBe(TOKEN_COUNT_FULL);
  // Rounding 99.6 up would read "ok 100%": the percent is cut, not rounded.
  expect(codexLimitOf(some, BETWEEN)).toEqual({ percent: 99 });
});

test("Codex: a last line with a null primary falls back to the earlier one", () => {
  const tail = [TOKEN_COUNT_FULL, TOKEN_COUNT_NO_PRIMARY, ""].join("\n");
  expect(codexLimitOf(tail, BETWEEN).blockedUntil).toBe(RESETS_AT);
  expect(codexLimitOf(TOKEN_COUNT_NO_PRIMARY, BETWEEN)).toEqual({});
});

test("Codex: the newest primary wins over an older one", () => {
  const older = TOKEN_COUNT_FULL.replace(
    '"used_percent":100.0',
    '"used_percent":10.0',
  );
  const tail = [TOKEN_COUNT_FULL, older].join("\n");
  expect(codexLimitOf(tail, BETWEEN)).toEqual({ percent: 10 });
});

test("Codex: a first line cut by tail is skipped without a throw", () => {
  const cut = TOKEN_COUNT_FULL.slice(40);
  const tail = [cut, TOKEN_COUNT_FULL].join("\n");
  expect(codexLimitOf(tail, BETWEEN).blockedUntil).toBe(RESETS_AT);
  expect(codexLimitOf(cut, BETWEEN)).toEqual({});
});

test("Codex: garbage is ok", () => {
  const odd = [
    "",
    "not json",
    "{",
    "[]",
    "null",
    '{"type":"event_msg","payload":{"type":"token_count"}}',
    '{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":"lots","resets_at":"soon"}}}}',
    '{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":100}}}}',
    '{"type":"response_item","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":100,"resets_at":1791640084}}}}',
  ].join("\n");
  expect(codexLimitOf(odd, BETWEEN)).toEqual({});
});

test("one verdict per executor: a future file epoch or the rollout blocks", () => {
  const texts = ["1791142352\n", "garbage", LIMIT_FILE];
  const at = BEFORE_FILE;
  const found = limitsOf({ texts, rollout: TOKEN_COUNT_FULL }, at);
  expect(found.devin).toEqual({ blockedUntil: FILE_AT });
  expect(found.pi).toEqual({});
  // the file says FILE_AT, the rollout RESETS_AT: the later one holds
  expect(found.codex).toEqual({ blockedUntil: RESETS_AT, percent: 100 });
});

test("real data: the codex file is past, the rollout says 100% ahead: blocked", () => {
  const found = limitsOf(
    { texts: [undefined, undefined, LIMIT_FILE], rollout: TOKEN_COUNT_FULL },
    BETWEEN,
  );
  expect(found.codex).toEqual({ blockedUntil: RESETS_AT, percent: 100 });
  expect(found.devin).toEqual({});
});

test("no rollout and no files: all ok", () => {
  expect(limitsOf({ texts: [] }, BETWEEN)).toEqual(NO_LIMITS.by);
});

test("the time is HH:MM today and weekday HH:MM later, in the given zone", () => {
  const at = Date.UTC(2026, 9, 10, 9, 0);
  expect(limitTimeOf(RESETS_AT, at, "UTC")).toBe("13:48");
  expect(limitTimeOf(RESETS_AT, at, "Europe/Moscow")).toBe("16:48");
  const earlier = Date.UTC(2026, 9, 5, 9, 0);
  expect(limitTimeOf(RESETS_AT, earlier, "UTC")).toBe("Sat 13:48");
  // the same instant is a different day in another zone
  expect(limitTimeOf(Date.UTC(2026, 9, 10, 22, 30), at, "UTC")).toBe("22:30");
  expect(limitTimeOf(Date.UTC(2026, 9, 10, 22, 30), at, "Asia/Tokyo")).toBe(
    "Sun 07:30",
  );
  expect(limitTimeOf(Date.UTC(2026, 9, 10, 0, 5), at, "UTC")).toBe("00:05");
});

const known = (by: Partial<ShellLimits["by"]>): ShellLimits => ({
  readAt: BETWEEN,
  by: { ...NO_LIMITS.by, ...by },
});

test("the limits line: ok executors, Codex with percent, blocked with a time", () => {
  expect(limitsLineOf(known({}), BETWEEN, "UTC")).toBe(
    "limits: devin ok · pi ok · codex ok",
  );
  expect(limitsLineOf(known({ codex: { percent: 42 } }), BETWEEN, "UTC")).toBe(
    "limits: devin ok · pi ok · codex ok 42%",
  );
  const blocked = known({ codex: { blockedUntil: RESETS_AT, percent: 100 } });
  expect(limitsLineOf(blocked, BETWEEN, "UTC")).toBe(
    "limits: devin ok · pi ok · codex 100% until Sat 13:48",
  );
  const noPercent = known({ pi: { blockedUntil: BETWEEN + HOUR } });
  expect(limitsLineOf(noPercent, BETWEEN, "UTC")).toBe(
    `limits: devin ok · pi limit until ${limitTimeOf(BETWEEN + HOUR, BETWEEN, "UTC")} · codex ok`,
  );
});

test("a block that has ended reads as ok at display time", () => {
  const stale = known({ codex: { blockedUntil: BETWEEN, percent: 100 } });
  expect(blockedOf(stale, BETWEEN)).toEqual([]);
  expect(limitsLineOf(stale, BETWEEN, "UTC")).toContain("codex ok");
});

test("the limits line before the first read says so", () => {
  expect(limitsLineOf(NO_LIMITS, BETWEEN, "UTC")).toBe("limits: …");
});

test("blockedOf lists the executors still blocked", () => {
  const both = known({
    devin: { blockedUntil: BETWEEN + HOUR },
    codex: { blockedUntil: RESETS_AT },
  });
  expect(blockedOf(both, BETWEEN)).toEqual(["devin", "codex"]);
  expect(blockedOf(NO_LIMITS, BETWEEN)).toEqual([]);
});

test("limits are read only for the open runners view or a live runner", () => {
  const live = [callOf({ id: "r1", runner: "pi" })];
  const done = [callOf({ id: "r2", runner: "pi", status: "done" })];
  const base = { view: "agents", isOpen: false, calls: [], now: 5000 } as const;
  expect(isLimitsDue(base)).toBe(false);
  expect(isLimitsDue({ ...base, isOpen: true })).toBe(false);
  expect(isLimitsDue({ ...base, isOpen: true, view: "runners" })).toBe(true);
  expect(isLimitsDue({ ...base, view: "runners" })).toBe(false);
  expect(isLimitsDue({ ...base, calls: live })).toBe(true);
  expect(isLimitsDue({ ...base, calls: done })).toBe(false);
  expect(isLimitsDue({ ...base, calls: [callOf({ id: "x" })] })).toBe(false);
});

test("limits are read at most every 30 seconds", () => {
  const live = {
    view: "agents",
    isOpen: false,
    calls: [callOf({ id: "r1", runner: "pi" })],
  } as const;
  expect(isLimitsDue({ ...live, now: 0 })).toBe(true);
  expect(isLimitsDue({ ...live, now: 31_000, readAt: 1000 })).toBe(true);
  expect(isLimitsDue({ ...live, now: 30_999, readAt: 1000 })).toBe(false);
  expect(isLimitsDue({ ...live, now: 1000, readAt: 1000 })).toBe(false);
});

test("the rollout is looked for in today's and yesterday's directories", () => {
  const at = new Date(2026, 9, 5, 18, 0).getTime();
  expect(sessionDirectoriesOf("/h", at)).toEqual([
    "/h/.codex/sessions/2026/10/05",
    "/h/.codex/sessions/2026/10/04",
  ]);
  const newYear = new Date(2027, 0, 1, 0, 30).getTime();
  expect(sessionDirectoriesOf("/h", newYear)[1]).toBe(
    "/h/.codex/sessions/2026/12/31",
  );
});

const file = (name: string, mtimeMs: number) =>
  ({ name, kind: "file", mtimeMs }) as const;

test("the newest rollout by mtimeMs wins across directories", () => {
  const found = newestRolloutOf([
    {
      directory: "/d/05",
      entries: [
        file("rollout-a.jsonl", 100),
        file("notes.txt", 900),
        { name: "rollout-dir.jsonl", kind: "dir", mtimeMs: 950 },
      ],
    },
    { directory: "/d/04", entries: [file("rollout-b.jsonl", 300)] },
  ]);
  expect(found).toBe("/d/04/rollout-b.jsonl");
  expect(newestRolloutOf([])).toBeUndefined();
  expect(newestRolloutOf([{ directory: "/d", entries: [] }])).toBeUndefined();
});

test("the limits file path", () => {
  expect(limitPathOf("/h", "codex")).toBe(
    "/h/.local/state/executor-limits/codex",
  );
});
