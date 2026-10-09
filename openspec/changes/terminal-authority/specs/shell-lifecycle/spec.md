## ADDED Requirements

### Requirement: Answered replay stops

Replay SHALL settle a background call as stopped only from a TaskStop tool-use row with result or text present and isError not true. It SHALL retain task_id and legacy shell_id support.

#### Scenario: Pending or denied stop

- **WHEN** a TaskStop row has neither result nor text, or isError is true
- **THEN** its target background call remains live

#### Scenario: Answered stop

- **WHEN** a non-error TaskStop row has a result or text and names a known task through task_id or shell_id
- **THEN** its target background call becomes stopped

### Requirement: Pinned live notification authority

Live append SHALL consume terminal notification XML only when the SDK-pinned origin kind is task-notification. It SHALL pass the original event to next exactly once and return the downstream result unchanged.

#### Scenario: Unauthenticated quote

- **WHEN** composer, model, unclassified or plugin origin appends notification XML, including through the delivery door
- **THEN** the background call remains live and the row is forwarded unchanged

#### Scenario: Supported notification ingress

- **WHEN** task-notification origin appends a supported notification through any SDK-supported door
- **THEN** the background call settles and door, origin, uuid, agentId and message content are forwarded unchanged with the downstream receipt

### Requirement: Replay preserves supported authority

Replay SHALL NOT derive terminal notices solely from message text. Supported session.messages and API content lack authenticated origin. Replay SHALL preserve known state, answered authoritative SDK results, history bounds, scope and trim behavior.

#### Scenario: Whole or prefixed XML in history

- **WHEN** replay contains whole-row or prefixed notification XML, including a user-role row
- **THEN** XML alone cannot settle a background call

#### Scenario: Known terminal state survives replay

- **WHEN** known state holds a settled call while replay reconstructs it as running
- **THEN** its supported known state is retained
