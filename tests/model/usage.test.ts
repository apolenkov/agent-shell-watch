import type { FsEntry } from "claude-code";
import { expect, test } from "claude-code/testing";

import {
  codexFilesOf,
  codexTotalOf,
  dueUsageOf,
  piDirectoriesOf,
  piFilesOf,
  sumPiUsage,
  tagOf,
  usageFrom,
  usageTextOf,
  windowOf,
} from "../../hooks/model/usage.ts";
import type { CallUsage } from "../../types";
import { callOf } from "../fixtures/call-of.ts";
import {
  CODEX_FIRST,
  CODEX_SECOND,
  PI_SUM,
  PI_USAGES,
  PI_USER_LINE,
  piLine,
} from "../fixtures/usage.ts";

const START = Date.UTC(2026, 9, 5, 14, 32, 9, 661);
const SECOND = 1000;

const entry = (name: string, over: Partial<FsEntry> = {}): FsEntry => ({
  kind: "file",
  size: 1,
  mtimeMs: 0,
  isLink: false,
  name,
  ...over,
});

test("Pi: the usage of every assistant line adds up", () => {
  const tail = [PI_USER_LINE, ...PI_USAGES.map((usage) => piLine(usage))].join(
    "\n",
  );
  const sum = sumPiUsage(tail);
  expect(sum?.tokens).toBe(PI_SUM.tokens);
  expect(Math.abs((sum?.cost ?? 0) - PI_SUM.cost)).toBeLessThan(1e-12);
});

test("Pi: the first line of a tail is cut and skipped, garbage too", () => {
  const cut = piLine(PI_USAGES[0]).slice(30);
  const tail = [cut, "not json", "{}", "[1]", piLine(PI_USAGES[1])].join("\n");
  expect(sumPiUsage(tail)).toEqual({
    tokens: 23_310,
    cost: 0.000097594,
  });
});

test("Pi: no usage line means unknown, not zero", () => {
  expect(sumPiUsage("")).toBeUndefined();
  expect(sumPiUsage(`${PI_USER_LINE}\n`)).toBeUndefined();
  expect(
    sumPiUsage(
      '{"type":"message","message":{"role":"assistant","usage":{"totalTokens":"x"}}}',
    ),
  ).toBeUndefined();
});

test("Codex: the total of the last token_count wins, cached input included", () => {
  expect(codexTotalOf(`${CODEX_FIRST}\n${CODEX_SECOND}\n`)).toBe(54_337);
  expect(codexTotalOf(`cut {"x":\n${CODEX_FIRST}\n`)).toBe(23_194);
});

test("Codex: no token_count means unknown", () => {
  expect(codexTotalOf("")).toBeUndefined();
  expect(codexTotalOf('{"type":"event_msg","payload":{"type":"x"}}')).toBe(
    undefined,
  );
});

test("Pi files: the start in the name, in UTC", () => {
  const files = piFilesOf([
    {
      directory: "/s/--w--",
      entries: [
        entry("2026-10-05T14-32-09-661Z_01a1.jsonl", { size: 7 }),
        entry("notes.txt"),
        entry("2026-10-05T14-32-09-661Z_x", { kind: "dir" }),
      ],
    },
  ]);
  expect(files).toEqual([
    {
      path: "/s/--w--/2026-10-05T14-32-09-661Z_01a1.jsonl",
      at: START,
      size: 7,
    },
  ]);
});

test("Pi directories: only those touched since the window opens", () => {
  const stats = [
    { name: "--old--", mtimeMs: START - 3 * SECOND },
    { name: "--edge--", mtimeMs: START - 2 * SECOND },
    { name: "--new--", mtimeMs: START + SECOND },
  ];
  expect(piDirectoriesOf(stats, START - 2 * SECOND)).toEqual([
    "--edge--",
    "--new--",
  ]);
});

// The name carries local time: the zone is passed, so no machine's zone matters.
test("Codex files: the local time in the name is read in the given zone", () => {
  const listing = [
    {
      directory: "/c/2026/10/05",
      entries: [entry("rollout-2026-10-05T16-48-52-01a1.jsonl", { size: 9 })],
    },
  ];
  const at = (zone: string): number | undefined =>
    codexFilesOf(listing, zone)[0]?.at;
  expect(at("Europe/Moscow")).toBe(Date.UTC(2026, 9, 5, 13, 48, 52));
  expect(at("America/New_York")).toBe(Date.UTC(2026, 9, 5, 20, 48, 52));
  expect(at("UTC")).toBe(Date.UTC(2026, 9, 5, 16, 48, 52));
  expect(codexFilesOf(listing, "UTC")[0]?.size).toBe(9);
});

test("a window opens 2 s before the start and closes when the call ends", () => {
  expect(windowOf(callOf({ startedAt: START }), START + 5 * SECOND)).toEqual({
    from: START - 2 * SECOND,
    to: START + 5 * SECOND,
  });
  expect(
    windowOf(callOf({ startedAt: START, endedAt: START + SECOND }), START + 9),
  ).toEqual({ from: START - 2 * SECOND, to: START + SECOND });
  expect(windowOf(callOf({ isTimeUnknown: true }), START)).toBeUndefined();
});

test("usageFrom: Pi sums, and is partial when the file is larger than the tail", () => {
  const tail = PI_USAGES.map((usage) => piLine(usage)).join("\n");
  const found = usageFrom("pi", tail, 1000);
  expect(found.tokens).toBe(PI_SUM.tokens);
  expect(Math.abs((found.cost ?? 0) - PI_SUM.cost)).toBeLessThan(1e-12);
  expect(usageFrom("pi", tail, 262_145)).toMatchObject({ isPartial: true });
  expect(usageFrom("pi", tail, 262_144)).not.toHaveProperty("isPartial");
});

test("usageFrom: Codex has tokens only and is never partial", () => {
  expect(usageFrom("codex", CODEX_SECOND, 10_000_000)).toEqual({
    tokens: 54_337,
  });
});

test("usageFrom: Devin, ocr and a missing tail are unknown", () => {
  expect(usageFrom("devin", CODEX_SECOND, 1)).toEqual({});
  expect(usageFrom("ocr", CODEX_SECOND, 1)).toEqual({});
  expect(usageFrom("pi", undefined, 1)).toEqual({});
  expect(usageFrom("codex", undefined, 1)).toEqual({});
});

const usage = (over: Partial<CallUsage> = {}): CallUsage => ({
  readAt: 0,
  ...over,
});

test("the cell: Pi says tokens and dollars, Codex tokens, the rest a dash", () => {
  const pi = callOf({ runner: "pi" });
  expect(usageTextOf(pi, usage({ tokens: 23_152, cost: 0.002317 }))).toBe(
    "23k tok · $0.002",
  );
  expect(usageTextOf(pi, usage({ tokens: 1500, cost: 0.4 }))).toBe(
    "1.5k tok · $0.400",
  );
  expect(usageTextOf(pi, usage({ tokens: 900, cost: 1 }))).toBe(
    "900 tok · $1.000",
  );
  expect(
    usageTextOf(callOf({ runner: "codex" }), usage({ tokens: 17_246_932 })),
  ).toBe("17M tok");
});

test("the cell: a partial file reads at least", () => {
  expect(
    usageTextOf(
      callOf({ runner: "pi" }),
      usage({ tokens: 70_338, cost: 0.002559, isPartial: true }),
    ),
  ).toBe("≥70k tok · ≥$0.003");
});

test("the cell: unknown is a dash, and Devin never has numbers", () => {
  expect(usageTextOf(callOf({ runner: "pi" }), undefined)).toBe("—");
  expect(usageTextOf(callOf({ runner: "pi" }), usage())).toBe("—");
  expect(
    usageTextOf(callOf({ runner: "devin" }), usage({ tokens: 5, cost: 1 })),
  ).toBe("—");
  expect(usageTextOf(callOf({ runner: "ocr" }), undefined)).toBe("—");
});

test("the tag: by and the cell when they fit", () => {
  expect(tagOf("main", "23k tok · $0.002", 40)).toBe(
    "← main · 23k tok · $0.002",
  );
});

test("the tag: the cell goes first, then by is cut", () => {
  expect(tagOf("main", "23k tok · $0.002", 10)).toBe("← main");
  expect(tagOf("general-purpose", "23k tok", 10)).toBe("← general…");
  expect(tagOf("general-purpose", "23k tok", 0)).toBe("← gener…");
});

test("the tag: by is cut to 32 cells even with room", () => {
  expect(tagOf("x".repeat(60), "—", 200)).toBe(`← ${"x".repeat(31)}… · —`);
});

test("usage is due for a shown Pi or Codex call, once, then every 30 s while live", () => {
  const pi = callOf({ id: "p", runner: "pi", startedAt: START });
  const codex = callOf({ id: "c", runner: "codex", startedAt: START });
  const devin = callOf({ id: "d", runner: "devin", startedAt: START });
  const plain = callOf({ id: "n", startedAt: START });
  const rebuilt = callOf({ id: "r", runner: "pi", isTimeUnknown: true });
  const calls = [pi, codex, devin, plain, rebuilt];
  expect(dueUsageOf(calls, {}, START).map((call) => call.id)).toEqual([
    "p",
    "c",
  ]);
  const read = { p: usage({ readAt: START }), c: usage({ readAt: START }) };
  expect(dueUsageOf(calls, read, START + 29_999)).toEqual([]);
  expect(dueUsageOf(calls, read, START + 30_000)).toHaveLength(2);
});

test("a settled call is read again only if it ended after the last read", () => {
  const ended = callOf({
    id: "p",
    runner: "pi",
    status: "done",
    startedAt: START,
    endedAt: START + 10_000,
  });
  const early = { p: usage({ readAt: START + 5000 }) };
  const late = { p: usage({ readAt: START + 10_000 }) };
  expect(dueUsageOf([ended], early, START + 99_000)).toHaveLength(1);
  expect(dueUsageOf([ended], late, START + 99_000)).toEqual([]);
});
