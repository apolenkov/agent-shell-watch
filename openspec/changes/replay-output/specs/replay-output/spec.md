## ADDED Requirements

### Requirement: Available replay output

Replay SHALL select nonempty structured stdout first. When stored bulk stdout is blank or unavailable, it SHALL use available model-facing text for the display tail. This text SHALL remain a summary and SHALL NOT be represented as reconstructed raw stdout.

#### Scenario: Blank bulk with available text

- **WHEN** an answered replay Bash call has blank or unavailable structured stdout and available text
- **THEN** its display tail uses that text

#### Scenario: Nonempty structured output

- **WHEN** a replay Bash call has nonempty structured stdout and different model-facing text
- **THEN** structured stdout supplies its tail and verdict

### Requirement: Honest guard verdict

Replay SHALL extract a runner verdict only when the selected available text ends with a valid guard line under the existing guard-line contract.

#### Scenario: Summary without a final guard

- **WHEN** available text has no valid final guard line, including a guard followed by ordinary text
- **THEN** no runner verdict is invented

### Requirement: Live empty output

Foreground handling SHALL retain a genuine empty structured stdout even when model-facing text is nonempty. Replay with no available output SHALL retain an empty tail.

#### Scenario: Genuine foreground empty stdout

- **WHEN** a live answered Bash call has an empty structured stdout and nonempty text
- **THEN** its stdout remains empty

#### Scenario: No replay output

- **WHEN** an answered replay call has no available stdout or text
- **THEN** its display tail remains empty
