# Require supported terminal authority

Pending TaskStop inputs and quoted task-notification XML currently settle background calls. Require an answered, non-error TaskStop during replay and SDK-pinned task-notification origin during live append. Replay message text has no authenticated origin and cannot establish terminal state.

Scope: ASW-02/03 / TASK-356.05.02. Preserve known state, answered Bash results, task_id/shell_id, history bounds, trim and scope. Forward each live append unchanged exactly once and return its actual downstream receipt. No transcript schema, persisted authority, parser or provider change.
