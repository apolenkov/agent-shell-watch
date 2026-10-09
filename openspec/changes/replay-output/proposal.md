# Replay output with missing bulk stdout

Stored headless Bash records may retain an empty stdout while model-facing text remains available. Replay currently selects the empty bulk field and loses the display tail and any guard verdict in that text.

Use available text only in the replay adapter when structured stdout is blank or unavailable. Nonempty structured output keeps precedence. The text is a summary; it does not reconstruct raw stdout. Shared live outcome handling keeps legitimate empty stdout.
