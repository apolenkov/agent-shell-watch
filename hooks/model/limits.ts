/**
 * Subscription limits of the external runners: one verdict per executor from
 * its `executor-limits/<name>` epoch and, for Codex, the last rate-limit
 * record in its newest rollout. Damaged or missing data reads as ok.
 */
import type {
  ExecutorLimit,
  LimitName,
  ShellCall,
  ShellLimits,
  ShellView,
} from "../../types";
import { parsedOf } from "../json.ts";
import { isLive } from "./calls.ts";

/** Nothing read yet: every executor ok. */
export const NO_LIMITS: ShellLimits = {
  by: { devin: {}, pi: {}, codex: {} },
};

/** The executors, in the order the limits line lists them. */
export const LIMIT_NAMES: readonly LimitName[] = ["devin", "pi", "codex"];

/** Bytes of a rollout's end the reader asks `tail -c` for. */
export const TAIL_BYTES = "65536";

const SECOND_MS = 1000;
const DAY_MS = 86_400_000;
const THROTTLE_MS = 30_000;
const FULL = 100;
const EPOCH = /^\d{1,13}$/u;

/**
 * The path of an executor's limits file.
 * @param home the home directory
 * @param name the executor
 * @returns the path
 */
export const limitPathOf = (home: string, name: LimitName): string =>
  `${home}/.local/state/executor-limits/${name}`;

/**
 * When the executor is blocked until, from its limits file: one epoch in
 * seconds. Past, empty or damaged reads as not blocked.
 * @param text the file's text
 * @param now the clock's time, ms
 * @returns the block's end in ms, or undefined
 */
export const limitFileOf = (text: string, now: number): number | undefined => {
  const trimmed = text.trim();
  const until = EPOCH.test(trimmed) ? Number(trimmed) * SECOND_MS : 0;
  return until > now ? until : undefined;
};

interface Primary {
  readonly percent: number;
  readonly resetsAt: number;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fieldOf = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

// The `primary` window of a `token_count` line; none on anything else.
const primaryOf = (line: string): readonly Primary[] => {
  const row = line.includes('"token_count"') ? parsedOf(line) : undefined;
  const payload = fieldOf(row, "payload");
  const primary = fieldOf(fieldOf(payload, "rate_limits"), "primary");
  const used = fieldOf(primary, "used_percent");
  const resets = fieldOf(primary, "resets_at");
  return fieldOf(row, "type") === "event_msg" &&
    fieldOf(payload, "type") === "token_count" &&
    isNumber(used) &&
    isNumber(resets)
    ? [{ percent: used, resetsAt: resets * SECOND_MS }]
    : [];
};

const lastPrimaryOf = (tail: string): Primary | undefined =>
  tail
    .split("\n")
    .flatMap((line) => primaryOf(line.trim()))
    .at(-1);

/**
 * Whether the end of a rollout holds a `token_count` with a `primary` window
 * (a run stopped at a spend cap writes one with `primary: null`).
 * @param tail the end of the rollout
 * @returns true when there is one
 */
export const hasPrimary = (tail: string): boolean =>
  lastPrimaryOf(tail) !== undefined;

/**
 * Codex's window from the end of a rollout: the newest `token_count` that
 * carries a `primary` (the last one may not), line by line, so a first line
 * cut by `tail -c` or any other surprise is skipped. Blocked at 100% with the
 * reset ahead; the percent shows while that window is still the current one.
 * @param tail the end of the rollout
 * @param now the clock's time, ms
 * @returns the limit, empty when nothing usable was found
 */
export const codexLimitOf = (tail: string, now: number): ExecutorLimit => {
  const primary = lastPrimaryOf(tail);
  return primary === undefined || primary.resetsAt <= now
    ? {}
    : {
        percent: Math.floor(primary.percent),
        ...(primary.percent >= FULL && { blockedUntil: primary.resetsAt }),
      };
};

/**
 * What one read found: the text of each limits file (in `LIMIT_NAMES` order,
 * undefined for a missing one), and Codex's rollout tail.
 */
export interface LimitReads {
  readonly texts: readonly (string | undefined)[];
  readonly rollout?: string | undefined;
}

const laterOf = (
  first: number | undefined,
  second: number | undefined,
): number | undefined =>
  first === undefined || second === undefined
    ? (first ?? second)
    : Math.max(first, second);

/**
 * One verdict per executor: blocked when its file's epoch is ahead or, for
 * Codex, the rollout's window is full with its reset ahead; the later end holds.
 * @param reads the files' texts and the rollout's tail
 * @param now the clock's time, ms
 * @returns each executor's limit
 */
export const limitsOf = (reads: LimitReads, now: number): ShellLimits["by"] => {
  const codex = codexLimitOf(reads.rollout ?? "", now);
  const of = (name: LimitName): ExecutorLimit => {
    const isCodex = name === "codex";
    const until = laterOf(
      limitFileOf(reads.texts[LIMIT_NAMES.indexOf(name)] ?? "", now),
      isCodex ? codex.blockedUntil : undefined,
    );
    return {
      ...(isCodex && codex.percent !== undefined && { percent: codex.percent }),
      ...(until !== undefined && { blockedUntil: until }),
    };
  };
  return { devin: of("devin"), pi: of("pi"), codex: of("codex") };
};

/**
 * Executors still blocked at `now`.
 * @param limits what the last read found
 * @param now the clock's time, ms
 * @returns their names, in the line's order
 */
export const blockedOf = (
  limits: ShellLimits,
  now: number,
): readonly LimitName[] =>
  LIMIT_NAMES.filter((name) => (limits.by[name].blockedUntil ?? 0) > now);

/**
 * The date and time fields of a moment in a zone, by their `Intl` part names.
 * @param at the moment, ms
 * @param zone an IANA time zone; the host's when not given
 * @returns the parts, as strings
 */
export const partsOf = (
  at: number,
  zone: string | undefined,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: zone,
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );

const dayOf = (parts: Readonly<Record<string, string>>): string =>
  `${parts["year"] ?? ""}-${parts["month"] ?? ""}-${parts["day"] ?? ""}`;

/**
 * When a block ends: `HH:MM` if that is today, else weekday and `HH:MM`.
 * @param until the block's end, ms
 * @param now the clock's time, ms
 * @param zone an IANA time zone; the host's when not given
 * @returns the text
 */
export const limitTimeOf = (
  until: number,
  now: number,
  zone?: string,
): string => {
  const end = partsOf(until, zone);
  const time = `${end["hour"] ?? ""}:${end["minute"] ?? ""}`;
  return dayOf(end) === dayOf(partsOf(now, zone))
    ? time
    : `${end["weekday"] ?? ""} ${time}`;
};

const cellOf = (
  name: LimitName,
  limit: ExecutorLimit,
  when: Readonly<{ now: number; zone?: string }>,
): string => {
  const { blockedUntil, percent } = limit;
  const shown = percent === undefined ? "" : `${String(percent)}%`;
  return blockedUntil !== undefined && blockedUntil > when.now
    ? [
        name,
        shown === "" ? "limit" : shown,
        "until",
        limitTimeOf(blockedUntil, when.now, when.zone),
      ].join(" ")
    : [name, "ok", shown].filter((part) => part !== "").join(" ");
};

/**
 * The runners view's line: `limits: devin ok · pi ok · codex 100% until Sat 13:48`.
 * @param limits what the last read found
 * @param now the clock's time, ms
 * @param zone an IANA time zone; the host's when not given
 * @returns the line; `limits: …` before the first read
 */
export const limitsLineOf = (
  limits: ShellLimits,
  now: number,
  zone?: string,
): string =>
  limits.readAt === undefined
    ? "limits: …"
    : `limits: ${LIMIT_NAMES.map((name) =>
        cellOf(name, limits.by[name], {
          now,
          ...(zone !== undefined && { zone }),
        }),
      ).join(" · ")}`;

/** What decides whether the limits are read now. */
export interface LimitsDue {
  readonly view: ShellView;
  readonly isOpen: boolean;
  readonly calls: readonly ShellCall[];
  readonly readAt?: number | undefined;
  readonly now: number;
}

/**
 * Whether to read the limits: only while the pane shows the runners view or a
 * runner is live, and at most every 30 s.
 * @param state the view, the pane, the calls, the last read and the time
 * @returns true when a read is due
 */
export const isLimitsDue = (state: LimitsDue): boolean =>
  (state.readAt === undefined || state.now - state.readAt >= THROTTLE_MS) &&
  ((state.isOpen && state.view === "runners") ||
    state.calls.some((call) => call.runner !== undefined && isLive(call)));

const PAD = 2;
const pad = (value: number): string => String(value).padStart(PAD, "0");

const sessionDirectoryOf = (home: string, at: number): string => {
  const day = new Date(at);
  return `${home}/.codex/sessions/${String(day.getFullYear())}/${pad(day.getMonth() + 1)}/${pad(day.getDate())}`;
};

/**
 * Codex's session directories worth a look: today's, then yesterday's.
 * @param home the home directory
 * @param now the clock's time, ms
 * @returns the two paths
 */
export const sessionDirectoriesOf = (
  home: string,
  now: number,
): readonly string[] => [
  sessionDirectoryOf(home, now),
  sessionDirectoryOf(home, now - DAY_MS),
];

/** One directory listing, as `$.fs.list` answers. */
export interface Listing {
  readonly directory: string;
  readonly entries: readonly Readonly<{
    name: string;
    kind: string;
    mtimeMs: number;
    size?: number;
  }>[];
}

/**
 * The newest rollout files of the listings, by `mtimeMs`.
 * @param count how many to keep
 * @param listings the directories and their entries
 * @returns the paths, newest first; empty when there is no rollout
 */
export const newestRolloutsOf = (
  count: number,
  listings: readonly Listing[],
): readonly string[] =>
  listings
    .flatMap(({ directory, entries }) =>
      entries
        .filter(
          (entry) =>
            entry.kind === "file" &&
            entry.name.startsWith("rollout-") &&
            entry.name.endsWith(".jsonl"),
        )
        .map((entry) => ({
          path: `${directory}/${entry.name}`,
          at: entry.mtimeMs,
        })),
    )
    .toSorted((first, second) => second.at - first.at)
    .slice(0, count)
    .map(({ path }) => path);
