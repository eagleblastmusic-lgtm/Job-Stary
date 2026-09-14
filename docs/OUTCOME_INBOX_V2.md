# Outcome Inbox — V2

Outcome Inbox is an optional candidate-side assistant for interpreting recruitment messages. V2 supports **manual paste** of a message and deliberately does not require mailbox access.

## Safety and privacy boundary

- Analysis never changes an application status.
- A suggested update is persisted separately and must be explicitly confirmed by the user.
- Raw message text is not stored. The database keeps a SHA-256 message hash, structured signal type, confidence and generic evidence codes.
- A dismissed suggestion cannot later mutate the application.
- Cross-user suggestion/application access is blocked by user-scoped queries.
- Existing application transition rules remain authoritative; confirmation fails when the proposed transition is not valid.

## Signals

The deterministic V2 classifier can suggest:

- rejection,
- interview invitation,
- job offer,
- recruiter contact.

Ambiguous or weak messages return no suggestion. Confidence is always below 1.0 and is shown to the user.

## Email integration

Provider-backed email access is intentionally deferred. The Master Plan calls this integration optional; adding a mailbox connector requires a separately authorized provider connection, consent/minimization review and provider-specific security work. The current product remains usable without granting mailbox access.

## Rollout

The feature is behind `outcome_inbox`, disabled by default, and uses the shared deterministic rollout/rollback mechanism.
