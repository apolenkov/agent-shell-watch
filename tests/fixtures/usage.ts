/**
 * Real numbers cut from the owner's files (2026-10-05): three consecutive Pi
 * assistant `message.usage` objects (their sum is 70338 tokens, $0.002559026,
 * checked with jq) and two Codex `token_count` totals. Nothing else of those
 * files is kept: no content, no ids.
 */

/** Three Pi `usage` objects, in file order. */
export const PI_USAGES = [
  '{"input":22909,"output":130,"cacheRead":113,"cacheWrite":0,"reasoning":22,"totalTokens":23152,"cost":{"input":0.0022909000000000002,"output":0.000026000000000000002,"cacheRead":2.26E-7,"cacheWrite":0,"total":0.002317126}}',
  '{"input":308,"output":105,"cacheRead":22897,"cacheWrite":0,"reasoning":0,"totalTokens":23310,"cost":{"input":0.0000308,"output":0.000021000000000000002,"cacheRead":0.000045794,"cacheWrite":0,"total":0.000097594}}',
  '{"input":466,"output":257,"cacheRead":23153,"cacheWrite":0,"reasoning":0,"totalTokens":23876,"cost":{"input":0.0000466,"output":0.0000514,"cacheRead":0.000046306,"cacheWrite":0,"total":0.000144306}}',
] as const;

/** The tokens and dollars of `PI_USAGES` together. */
export const PI_SUM = { tokens: 70_338, cost: 0.002559026 } as const;

/** A Pi session line holding one assistant usage. */
export const piLine = (usage: string): string =>
  `{"type":"message","message":{"role":"assistant","usage":${usage}}}`;

/** A Pi line that is not an assistant's (a user message has no usage). */
export const PI_USER_LINE = '{"type":"message","message":{"role":"user"}}';

const codexUsage = (counts: string): string =>
  `{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":${counts}}}}`;

/** Two Codex `token_count` lines of one rollout: the total grows. */
export const CODEX_FIRST = codexUsage(
  '{"input_tokens":22907,"cached_input_tokens":12032,"cache_write_input_tokens":0,"output_tokens":287,"reasoning_output_tokens":23,"total_tokens":23194}',
);
export const CODEX_SECOND = codexUsage(
  '{"input_tokens":53934,"cached_input_tokens":34816,"cache_write_input_tokens":0,"output_tokens":403,"reasoning_output_tokens":23,"total_tokens":54337}',
);
