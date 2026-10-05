/**
 * What a runner call spent: the session file of a Pi or Codex run is found by
 * the time in its name (the call's cwd is unknown), its end is summed, and the
 * cell for the runner's row is worded. Devin and ocr keep no usage: always a
 * dash. The files are the tools' own: anything that does not parse is skipped.
 */
import type {
  CallUsage,
  ShellCall,
  ShellRunner,
  ShellUsage,
} from "../../types";
import { parsedOf } from "../json.ts";
import { isLive } from "./calls.ts";
import { fit } from "./layout.ts";
import { type Listing, partsOf } from "./limits.ts";

/** Bytes of a Pi session's end the reader asks `tail -c` for. */
export const PI_TAIL_BYTES = "262144";
/** Bytes of a Codex rollout's end the reader asks `tail -c` for. */
export const CODEX_TAIL_BYTES = "65536";

const MINUTE_MS = 60_000;
const SLACK_MS = 2000;
const THROTTLE_MS = 30_000;
const PI_TAIL = Number(PI_TAIL_BYTES);
const BY_MAX = 32;
// The least a tag keeps for `← by`: cut by, never gone.
const TAG_MIN = 8;
const DASH = "—";
const SEPARATOR = " · ";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fieldOf = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Tokens and dollars of a Pi session. */
export interface PiSum {
  readonly tokens: number;
  readonly cost: number;
}

// An assistant line's `message.usage`: its tokens and dollars; none otherwise.
const piUsageOf = (line: string): readonly PiSum[] => {
  const row = line.includes('"usage"') ? parsedOf(line) : undefined;
  const message = fieldOf(row, "message");
  const usage = fieldOf(message, "usage");
  const tokens = fieldOf(usage, "totalTokens");
  const cost = fieldOf(fieldOf(usage, "cost"), "total");
  return fieldOf(row, "type") === "message" &&
    fieldOf(message, "role") === "assistant" &&
    isNumber(tokens) &&
    isNumber(cost)
    ? [{ tokens, cost }]
    : [];
};

/**
 * The tokens and dollars of a Pi session's end: the usage of every assistant
 * message, line by line, so a first line cut by `tail -c` or any other
 * surprise is skipped.
 * @param tail the end of the session file
 * @returns the sums, or undefined when no line carried a usage
 */
export const sumPiUsage = (tail: string): PiSum | undefined => {
  const usages = tail.split("\n").flatMap((line) => piUsageOf(line.trim()));
  return usages.length === 0
    ? undefined
    : {
        tokens: usages.reduce((sum, one) => sum + one.tokens, 0),
        cost: usages.reduce((sum, one) => sum + one.cost, 0),
      };
};

const codexTotalsOf = (line: string): readonly number[] => {
  const row = line.includes('"token_count"') ? parsedOf(line) : undefined;
  const payload = fieldOf(row, "payload");
  const total = fieldOf(
    fieldOf(fieldOf(payload, "info"), "total_token_usage"),
    "total_tokens",
  );
  return fieldOf(row, "type") === "event_msg" &&
    fieldOf(payload, "type") === "token_count" &&
    isNumber(total)
    ? [total]
    : [];
};

/**
 * A Codex session's tokens: `total_tokens` (cached input included) of the
 * last `token_count` in the end of the rollout.
 * @param tail the end of the rollout
 * @returns the total, or undefined when no line carried one
 */
export const codexTotalOf = (tail: string): number | undefined =>
  tail
    .split("\n")
    .flatMap((line) => codexTotalsOf(line.trim()))
    .at(-1);

/** One session file the listing shows: where, when it started, how big. */
export interface SessionFile {
  readonly path: string;
  readonly at: number;
  readonly size: number;
}

/** When a call can have started its session: a moment either side counts. */
export interface CallWindow {
  readonly from: number;
  readonly to: number;
}

/**
 * The window a call's session starts in: 2 s before the call to its end (now
 * while it runs). A call rebuilt from a transcript has no start: no window.
 * @param call the call
 * @param now the clock's time, ms
 * @returns the window, or undefined
 */
export const windowOf = (
  call: ShellCall,
  now: number,
): CallWindow | undefined =>
  call.isTimeUnknown === true
    ? undefined
    : { from: call.startedAt - SLACK_MS, to: call.endedAt ?? now };

const nearest = (
  files: readonly SessionFile[],
  near: number,
): SessionFile | undefined =>
  files.toSorted(
    (a, b) => Math.abs(a.at - near) - Math.abs(b.at - near) || a.at - b.at,
  )[0];

/**
 * The session whose start is in the window. Without `near` it must be the only
 * one; with `near` (Codex) the one nearest to that moment, the earlier on a tie.
 * ponytail: Pi's two runners started in the same second make the answer
 * unknown (a dash beats a guess); for Codex the nearest start can still be a
 * neighbour's when two are started within moments of each other.
 * @param files the candidates
 * @param window the call's window
 * @param near the call's start, ms; when given, the nearest candidate wins
 * @returns the file, or undefined for none (or several without `near`)
 */
export const pickSession = (
  files: readonly SessionFile[],
  window: CallWindow,
  near?: number,
): SessionFile | undefined => {
  const inside = files.filter(
    (file) => file.at >= window.from && file.at <= window.to,
  );
  const only = inside.length === 1 ? inside[0] : undefined;
  return near === undefined ? only : nearest(inside, near);
};

// Both names hold the start with `-` for `:`; Pi's in UTC with milliseconds.
const PI_NAME =
  /^(?<day>\d{4}-\d{2}-\d{2})T(?<h>\d{2})-(?<m>\d{2})-(?<s>\d{2})-(?<ms>\d{3})Z_.+\.jsonl$/u;
const CODEX_NAME =
  /^rollout-(?<day>\d{4}-\d{2}-\d{2})T(?<h>\d{2})-(?<m>\d{2})-(?<s>\d{2})-.+\.jsonl$/u;

// The name's clock fields read as UTC, 0 ms when the name has none.
const utcOf = (groups: Readonly<Record<string, string | undefined>>): number =>
  Date.parse(
    `${groups["day"] ?? ""}T${groups["h"] ?? ""}:${groups["m"] ?? ""}:${groups["s"] ?? ""}.${groups["ms"] ?? "000"}Z`,
  );

const filesOf = (
  listings: readonly Listing[],
  pattern: Readonly<RegExp>,
  atOf: (utc: number) => number,
): readonly SessionFile[] =>
  listings.flatMap(({ directory, entries }) =>
    entries
      .filter((entry) => entry.kind === "file")
      .flatMap((entry) => {
        const groups = pattern.exec(entry.name)?.groups;
        return groups === undefined
          ? []
          : {
              path: `${directory}/${entry.name}`,
              at: atOf(utcOf(groups)),
              size: entry.size ?? 0,
            };
      }),
  );

/**
 * Pi's session directories worth a listing: touched since the window opens.
 * @param stats the directories of `~/.pi/agent/sessions` with their `$.fs.stat`
 *   mtimes (the listing has 0 for a directory)
 * @param since the earliest moment a session can have started, ms
 * @returns the directories' names
 */
export const piDirectoriesOf = (
  stats: readonly Readonly<{ name: string; mtimeMs: number }>[],
  since: number,
): readonly string[] =>
  stats.filter((stat) => stat.mtimeMs >= since).map((stat) => stat.name);

/**
 * Pi's session files, each with its start, which the name holds in UTC with
 * milliseconds: `2026-10-05T14-32-09-661Z_<id>.jsonl`.
 * @param listings the listed directories
 * @returns the files
 */
export const piFilesOf = (
  listings: readonly Listing[],
): readonly SessionFile[] => filesOf(listings, PI_NAME, (utc) => utc);

// Local clock fields read as UTC, less the zone's offset: what the zone shows
// at that guess, less the guess. ponytail: off by up to an hour inside the hour
// of a DST switch.
const localToEpoch = (guess: number, zone: string | undefined): number => {
  const shown = partsOf(guess, zone);
  const asUtc = Date.parse(
    `${shown["year"] ?? ""}-${shown["month"] ?? ""}-${shown["day"] ?? ""}T${shown["hour"] ?? ""}:${shown["minute"] ?? ""}Z`,
  );
  return guess - (asUtc - Math.floor(guess / MINUTE_MS) * MINUTE_MS);
};

/**
 * Codex's rollouts, each with its start, which the name holds in local time:
 * `rollout-2026-10-05T16-48-52-<id>.jsonl`.
 * @param listings the listed day directories
 * @param zone an IANA time zone; the host's when not given
 * @returns the files
 */
export const codexFilesOf = (
  listings: readonly Listing[],
  zone?: string,
): readonly SessionFile[] =>
  filesOf(listings, CODEX_NAME, (utc) => localToEpoch(utc, zone));

/** What the session file of one call said; empty when unknown. */
export type Found = Omit<CallUsage, "readAt">;

const piFound = (tail: string, size: number): Found => {
  const sum = sumPiUsage(tail);
  return sum === undefined
    ? {}
    : { ...sum, ...(size > PI_TAIL && { isPartial: true }) };
};

const codexFound = (tail: string): Found => {
  const tokens = codexTotalOf(tail);
  return tokens === undefined ? {} : { tokens };
};

// Devin and ocr keep nothing to read.
const FOUND: Partial<
  Readonly<Record<ShellRunner, (tail: string, size: number) => Found>>
> = { pi: piFound, codex: codexFound };

/**
 * What the end of a session file says of its run: Pi's tokens and dollars
 * (partial when the file is larger than the end that was read), Codex's total.
 * @param runner the call's runner
 * @param tail the end of the session file, undefined when it was not read
 * @param size the file's size in bytes
 * @returns the found numbers, empty when unknown
 */
export const usageFrom = (
  runner: ShellRunner,
  tail: string | undefined,
  size: number,
): Found => (tail === undefined ? {} : (FOUND[runner]?.(tail, size) ?? {}));

const COMPACT = new Intl.NumberFormat("en", { notation: "compact" });
const COST_DIGITS = 3;

/**
 * The runner row's cell: `23k tok · $0.002` (`≥` first when only the end of a
 * file was summed), tokens alone for Codex, a dash when unknown or Devin.
 * @param call the runner call
 * @param usage what was read for it
 * @returns the cell
 */
export const usageTextOf = (
  call: ShellCall,
  usage: CallUsage | undefined,
): string => {
  const known = call.runner === "devin" ? undefined : usage;
  const mark = known?.isPartial === true ? "≥" : "";
  return known?.tokens === undefined
    ? DASH
    : [
        `${mark}${COMPACT.format(known.tokens).replace("K", "k")} tok`,
        ...(known.cost === undefined
          ? []
          : [`${mark}$${known.cost.toFixed(COST_DIGITS)}`]),
      ].join(SEPARATOR);
};

/**
 * The tag after a runner's status: `← main · 23k tok · $0.002`. When the room
 * is short the cell goes first, then `by` is cut (never below a few cells).
 * @param by who started the call
 * @param usage the cell
 * @param room the cells the tag may take
 * @returns the tag
 */
export const tagOf = (by: string, usage: string, room: number): string => {
  const lead = `← ${fit(by, BY_MAX)}`;
  const full = usage === "" ? lead : `${lead}${SEPARATOR}${usage}`;
  return full.length <= room ? full : fit(lead, Math.max(room, TAG_MIN));
};

const isReadable = (call: ShellCall): boolean =>
  (call.runner === "pi" || call.runner === "codex") &&
  call.isTimeUnknown !== true;

// Never read: now. Read: 30 s ago while live; once settled, only if it ended
// after the last read.
const isDue = (
  call: ShellCall,
  known: CallUsage | undefined,
  now: number,
): boolean =>
  known === undefined ||
  (now - known.readAt >= THROTTLE_MS &&
    (isLive(call) || (call.endedAt ?? 0) > known.readAt));

/**
 * The calls whose session file is to be read now.
 * @param shown the runner calls the pane shows
 * @param known what earlier reads found
 * @param now the clock's time, ms
 * @returns the Pi and Codex calls that are due
 */
export const dueUsageOf = (
  shown: readonly ShellCall[],
  known: ShellUsage,
  now: number,
): readonly ShellCall[] =>
  shown.filter((call) => isReadable(call) && isDue(call, known[call.id], now));

/**
 * A read that found nothing keeps the earlier numbers and only moves readAt.
 * @param known the cells held
 * @param found the cells the read made
 * @returns the cells to hold
 */
export const keptWhenEmpty = (
  known: ShellUsage,
  found: ShellUsage,
): ShellUsage =>
  Object.fromEntries(
    Object.entries(found).map(([id, now]) => {
      const before = known[id];
      const isEmpty = now.tokens === undefined && now.cost === undefined;
      return [
        id,
        isEmpty && before !== undefined
          ? { ...before, readAt: now.readAt }
          : now,
      ];
    }),
  );
