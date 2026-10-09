/** Finite shell policy over the maintained parser; it never executes source. */
import type { ShellRunner } from "../../types";
import { parse } from "../../vendor/unbash/dist/parser.js";
import type {
  Assignment,
  Command,
  CommandArgument,
  CommandNode,
  Pipeline,
  PipelineNode,
  Redirection,
  Word,
  WordPart,
} from "../../vendor/unbash/dist/types.js";

const RUNNERS: ReadonlySet<string> = new Set(["codex", "pi", "devin", "ocr"]);
const GUARDS: ReadonlySet<string> = new Set(["w", "agent-runner-guard"]);
const GUARD_SCRIPTS: ReadonlySet<string> = new Set([
  "w.ts",
  "guard.ts",
  "watchdog.ts",
]);
const GUARD_OPTIONS: ReadonlySet<string> = new Set([
  "--silence",
  "--max-seconds",
  "--alert-file",
  "--watch-file",
]);
const SHELLS: ReadonlySet<string> = new Set(["bash", "sh", "zsh"]);
const SHELL_FLAGS = /^-[aefnuvxlc]+$/u;
const EXPANDING_LITERAL = /[*?[~]/u;
const MAX_DEPTH = 4;
const OPTION_PAIR = 2;

type Argv = readonly (string | undefined)[];

interface Selection {
  readonly runner: ShellRunner | undefined;
  readonly watchPath: string | undefined;
  readonly prompt: string | undefined;
  readonly flagged: boolean;
  readonly routed: boolean;
}

const UNKNOWN: Selection = {
  runner: undefined,
  watchPath: undefined,
  prompt: undefined,
  flagged: false,
  routed: false,
};
const basename = (word: string | undefined): string =>
  word?.split("/").at(-1) ?? "";
const isStaticPart = (part: WordPart): boolean =>
  (part.type === "Literal" && !EXPANDING_LITERAL.test(part.text)) ||
  part.type === "SingleQuoted" ||
  part.type === "AnsiCQuoted" ||
  (part.type === "DoubleQuoted" &&
    part.parts.every((child) => child.type === "Literal"));
const literalOf = (word: Word | undefined): string | undefined => {
  const parts = word?.parts;
  // eslint-disable-next-line functional/prefer-tacit -- Unicorn requires an explicit unary array callback.
  const arePartsStatic = parts?.every((part) => isStaticPart(part));
  const isStatic = arePartsStatic ?? !EXPANDING_LITERAL.test(word?.text ?? "");
  return isStatic ? word?.value : undefined;
};
const assignmentOf = (argument: Assignment): string | undefined => {
  const value =
    argument.value.type === "Word" ? literalOf(argument.value) : undefined;
  const append = argument.append === true ? "+" : "";
  return value === undefined || argument.index !== undefined
    ? undefined
    : `${argument.name}${append}=${value}`;
};
const argumentOf = (argument: CommandArgument): string | undefined =>
  argument.type === "Word" ? literalOf(argument) : assignmentOf(argument);
const selected = (selections: readonly Selection[]): Selection =>
  selections.find((one) => one.runner !== undefined) ??
  selections.find((one) => one.watchPath !== undefined) ??
  UNKNOWN;

const watched = (child: Selection, value: string | undefined): Selection => ({
  ...child,
  watchPath: value === "" ? undefined : value,
  flagged: true,
});
const guardPairOf = (args: Argv, depth: number): Selection => {
  const [option, value, ...rest] = args;
  const child = guardOf(rest, depth);
  return option === "--watch-file" ? watched(child, value) : child;
};
const guardOptionsOf = (args: Argv, depth: number): Selection => {
  const option = args[0];
  const paired =
    args.length >= OPTION_PAIR && GUARD_OPTIONS.has(option ?? "")
      ? guardPairOf(args, depth)
      : UNKNOWN;
  return option?.startsWith("--watch-file=") === true
    ? watched(
        guardOf(args.slice(1), depth),
        option.slice("--watch-file=".length),
      )
    : paired;
};
const guardOf = (args: Argv, depth: number): Selection =>
  args[0] === "--"
    ? argvOf(args.slice(1), depth + 1)
    : guardOptionsOf(args, depth);
const shellOptionOf = (args: Argv): string | undefined =>
  args[0]?.includes("c") === true ? args[1] : scriptOf(args.slice(1));
const scriptOf = (args: Argv): string | undefined => {
  const option = args[0];
  return option !== undefined && SHELL_FLAGS.test(option)
    ? shellOptionOf(args)
    : undefined;
};
const runnerArgvOf = (argv: Argv): Selection => {
  const [head, ...args] = argv;
  const name = basename(head);
  const isPositional =
    args[0] === "exec" && name === "codex" && args[1]?.startsWith("-") !== true;
  const prompt = isPositional || args[0] === "-p" ? args[1] : undefined;
  return { ...UNKNOWN, runner: name as ShellRunner, prompt };
};
const wrapperOf = (argv: Argv, depth: number): Selection => {
  const [head, ...args] = argv;
  const name = basename(head);
  const direct = GUARDS.has(name) ? args : undefined;
  const scripted =
    name === "node" && GUARD_SCRIPTS.has(basename(args[0]))
      ? args.slice(1)
      : undefined;
  const guard = direct ?? scripted;
  const script = SHELLS.has(name) ? scriptOf(args) : undefined;
  const shell = script === undefined ? UNKNOWN : shellOf(script, depth + 1);
  return guard === undefined ? shell : guardOf(guard, depth);
};
const namedArgvOf = (argv: Argv, depth: number): Selection =>
  RUNNERS.has(basename(argv[0])) ? runnerArgvOf(argv) : wrapperOf(argv, depth);
const argvOf = (argv: Argv, depth: number): Selection =>
  depth > MAX_DEPTH ? UNKNOWN : namedArgvOf(argv, depth);

const hasStdoutEffect = (redirect: Redirection): boolean => {
  const descriptor = redirect.descriptor;
  return descriptor === undefined
    ? redirect.type === "Redirect" &&
        (redirect.operator.startsWith(">") ||
          redirect.operator.startsWith("&>"))
    : descriptor.type !== "FileDescriptor" || descriptor.value === 1;
};
const outputTargetOf = (output: readonly Redirection[]): string | null => {
  const redirect = output[0];
  const target =
    redirect?.type === "Redirect" ? literalOf(redirect.target) : undefined;
  return output.length === 1 &&
    redirect?.type === "Redirect" &&
    (redirect.operator === ">" || redirect.operator === ">>") &&
    target?.startsWith("/") === true
    ? target
    : null;
};
const stdoutOf = (
  redirects: readonly Redirection[],
): string | null | undefined => {
  // eslint-disable-next-line functional/prefer-tacit -- Unicorn requires an explicit unary array callback.
  const output = redirects.filter((redirect) => hasStdoutEffect(redirect));
  return output.length === 0 ? undefined : outputTargetOf(output);
};
const simpleOf = (command: Command, depth: number): Selection => {
  const child = argvOf(
    [literalOf(command.name), ...Array.from(command.args, argumentOf)],
    depth,
  );
  const output = stdoutOf(command.redirects);
  const watchPath = child.routed ? undefined : (output ?? undefined);
  return output === undefined || child.flagged || child.runner === undefined
    ? child
    : {
        ...child,
        watchPath,
        routed: true,
      };
};
const commandOf = (command: CommandNode, depth: number): Selection =>
  command.type === "Command" ? simpleOf(command, depth) : UNKNOWN;
const hasStdinEffect = (redirect: Redirection): boolean => {
  const descriptor = redirect.descriptor;
  return descriptor === undefined
    ? redirect.type !== "Redirect" || redirect.operator.startsWith("<")
    : descriptor.type !== "FileDescriptor" || descriptor.value === 0;
};
const teeTargetOf = (command: Command): string | null => {
  const args = Array.from(command.args, argumentOf);
  const files = args[0] === "-a" ? args.slice(1) : args;
  const target = files[0];
  const hasInput = Array.from(command.redirects, hasStdinEffect).includes(true);
  return !hasInput && files.length === 1 && target?.startsWith("/") === true
    ? target
    : null;
};
const teeOf = (command: CommandNode): string | null | undefined =>
  command.type === "Command" && basename(literalOf(command.name)) === "tee"
    ? teeTargetOf(command)
    : undefined;
const pipedOf = (node: Pipeline, depth: number): Selection => {
  const leaves = node.commands.map((command) => commandOf(command, depth));
  const first = selected(leaves);
  const index = leaves.indexOf(first);
  const tees = Array.from(node.commands.slice(index + 1), teeOf).filter(
    (path) => path !== undefined,
  );
  const next = node.commands[index + 1];
  const target = next === undefined ? undefined : teeOf(next);
  const isSingleRunner =
    leaves.filter((leaf) => leaf.runner !== undefined).length === 1;
  const watchPath =
    isSingleRunner && tees.length === 1 && !first.routed
      ? (target ?? undefined)
      : undefined;
  return target === undefined || first.flagged || first.runner === undefined
    ? first
    : { ...first, watchPath, routed: true };
};
const pipelineOf = (node: PipelineNode, depth: number): Selection => {
  const simple = node.type === "Command" ? commandOf(node, depth) : UNKNOWN;
  return node.type === "Pipeline" ? pipedOf(node, depth) : simple;
};
const parsedOf = (command: string, depth: number): Selection => {
  const script = parse(command);
  return (script.errors?.length ?? 0) > 0
    ? UNKNOWN
    : selected(
        script.commands.flatMap(({ command: node }) =>
          node.type === "AndOr"
            ? node.commands.map((part) => pipelineOf(part, depth))
            : [pipelineOf(node, depth)],
        ),
      );
};

/**
 * Selects a supported executable and its own static argv/output from shell
 * structure. Unsupported syntax and parser errors remain unknown.
 * @param command shell source
 * @param depth bounded nesting through actual shell/guard wrappers
 * @returns the selected runner, prompt and watched output
 */
export const shellOf = (command: string, depth = 0): Selection => {
  // eslint-disable-next-line functional/no-try-statements -- Upstream parse and lazy word getters may throw; unsupported input must remain unknown.
  try {
    return depth > MAX_DEPTH ? UNKNOWN : parsedOf(command, depth);
  } catch {
    return UNKNOWN;
  }
};
