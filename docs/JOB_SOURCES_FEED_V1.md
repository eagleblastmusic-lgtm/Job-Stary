# Job Sources, Feed & Deduplication V1

## Active scope

V1 introduces the source-connector boundary, provenance tracking, a unified candidate-side feed and deterministic deduplication.

The only active connector in this release is `user_provided`: the candidate explicitly supplies the job text and may optionally supply the source URL and publication date. This connector performs no external network discovery or scraping.

The architecture accepts additional connector kinds only when the source is authorized for that use:
- official API;
- licensed feed;
- partnership;
- legally usable public dataset;
- permitted career page;
- user-provided content.

No unauthorized scraping is implemented or claimed.

## Connector contract

Each connector exposes:
- `fetch()`;
- `normalize()`;
- `provenance()`;
- terms metadata;
- health status.

Each registered source is independently enableable/disableable by an administrator. A disabled source fails closed before ingestion. Terms metadata and health state are persisted in the source registry so future external connectors can be reviewed and disabled independently.

## Unified feed

The feed is behind the `job_feed` feature flag and supports:
- recommended jobs;
- saved jobs;
- hidden jobs;
- not-interested jobs;
- source/provenance;
- freshness;
- latest Decision Engine recommendation/override;
- bounded pagination.

State changes never hard-block a later application. Hiding or marking a job as not interesting only changes the feed view.

## Deduplication

V1 applies deterministic stages in this order:
1. canonical exact source URL;
2. normalized company + title + location;
3. parsed job text fingerprint.

The same canonical URL from the same source is idempotent: a repeated import refreshes `last_seen_at` instead of creating another observation. A sufficiently later observation with a different source URL but the same normalized identity may be classified separately as a `REPOST` instead of a true duplicate.

Semantic-similarity deduplication is intentionally deferred. The current implementation does not make an LLM similarity call or hide offers based on an opaque model.

## Decision boundary

When a new canonical job is created, the existing deterministic Decision Engine runs against the user's current profile and Career Truth. Feed size does not override Decision quality. Duplicates/reposts point to the same canonical job and do not generate parallel Decision records.

## Privacy and ownership

- feed state and observations are user-scoped;
- foreign and nonexistent job IDs expose the same not-found mutation contract;
- source observations and feed state are included in user data export;
- source administration is ADMIN-only and audited;
- raw external crawling data is not collected because no crawler is present in V1.

## Evidence

Server/API tests cover feature gating, canonical ingestion, exact-URL idempotency, normalized-identity reposts, Decision creation, ownership, export and fail-closed source disablement. Playwright/axe covers mobile and desktop feed interaction and the explicit user-provided-source boundary.
