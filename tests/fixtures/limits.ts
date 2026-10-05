/**
 * Real data cut from the owner's files (2026-10-05): two `token_count` lines of
 * the newest Codex rollout and the `codex` limits file. Nothing else of those
 * files is kept.
 */

/** The rollout's last `token_count`: its `primary` was null (workspace limit). */
export const TOKEN_COUNT_NO_PRIMARY =
  '{"timestamp":"2026-10-05T15:09:43.410Z","ordinal":1053,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":17150842,"cached_input_tokens":16583424,"cache_write_input_tokens":0,"output_tokens":96090,"reasoning_output_tokens":15654,"total_tokens":17246932},"last_token_usage":{"input_tokens":130937,"cached_input_tokens":128512,"cache_write_input_tokens":0,"output_tokens":4055,"reasoning_output_tokens":43,"total_tokens":134992},"model_context_window":258400},"rate_limits":{"limit_id":"premium","limit_name":null,"primary":null,"secondary":null,"credits":{"has_credits":true,"unlimited":false,"balance":null},"individual_limit":null,"spend_control_reached":null,"plan_type":"self_serve_business_prolite","rate_limit_reached_type":"workspace_member_usage_limit_reached"}}}';

/** The rollout's last `token_count` that carried a `primary`: 100%, resets 1791640084. */
export const TOKEN_COUNT_FULL =
  '{"timestamp":"2026-10-05T15:09:42.886Z","ordinal":1052,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":17150842,"cached_input_tokens":16583424,"cache_write_input_tokens":0,"output_tokens":96090,"reasoning_output_tokens":15654,"total_tokens":17246932},"last_token_usage":{"input_tokens":130937,"cached_input_tokens":128512,"cache_write_input_tokens":0,"output_tokens":4055,"reasoning_output_tokens":43,"total_tokens":134992},"model_context_window":258400},"rate_limits":{"limit_id":"codex","limit_name":null,"primary":{"used_percent":100.0,"window_minutes":10080,"resets_at":1791640084},"secondary":null,"credits":{"has_credits":true,"unlimited":false,"balance":null},"individual_limit":null,"spend_control_reached":null,"plan_type":"self_serve_business_prolite","rate_limit_reached_type":null}}}';

/** The `codex` limits file: one epoch in seconds, in the past. */
export const LIMIT_FILE = "1791142352\n";
