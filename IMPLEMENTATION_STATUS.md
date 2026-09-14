# Job — implementation status

Last refreshed: 2026-09-13

This file records repository evidence against `JOB_APP_MASTER_IMPLEMENTATION_PLAN.md`. Repository code is never treated as proof of real-user, legal, provider or production-infrastructure acceptance.

## Overall status

**Repository implementation through V2 is complete on this branch, subject to the final full CI gate.**

Implemented product line:

1. MVP 0.1 — Decision → Application → Outcome.
2. MVP 0.2 — Today / Action Priority and useful in-app Notifications.
3. V1 — Interview Prep, source connector boundary, Job Feed/deduplication and Bottleneck Engine.
4. V1.5 — Local Labour Intelligence, Effective Wage, Skill ROI and Just-in-Time Learning.
5. V2 — Career Transition, Outcome Inbox and Strategy Engine/Data Flywheel hooks.

The following roadmap items are intentionally **not claimed complete** because the Master Plan itself requires evidence or approval that repository code cannot create:

- **V2.5 native mobile:** build only after PWA product-market fit. No PMF evidence exists yet, so starting a React Native/Expo client now would violate the plan.
- **V3 cross-user intelligence:** only after privacy/legal review plus aggregation/minimum-cohort, anonymization/pseudonymization and fairness safeguards. Those approvals do not exist yet.

## Core application

- registration/login, bounded credentials, opaque hashed sessions and HttpOnly cookies;
- onboarding and Career Profile without requiring a CV;
- Career Truth with provenance/status/confidence, user corrections and no automatic confirmation of inferred facts;
- private CV upload boundary, file validation, malware-scanner integration boundary and grounded CV generation;
- Polish Job Parser, deterministic explainable Decision Engine and user override;
- Application Package, server-side PDF CV, Application Tracker and outcome capture;
- consent management, personal-data export, re-authenticated account deletion and backup/restore exercise;
- FREE/TRIAL/PRO/JOB_SPRINT configuration, admin diagnostics and audited out-of-band admin provisioning;
- mobile-first PWA/web interface.

## Post-MVP features

### Today / Action Priority
Deterministic action ranking, 10/30/60/120-minute budgets, maximum three actions, persisted accept/complete state and no guilt/streak mechanics. Feature-gated.

### Notifications
Configurable in-app follow-up/deadline notifications with persisted read/dismiss state and deduplication. External email/SMS/push delivery is not claimed.

### Interview Prep Pack
Uses saved job/application and confirmed Career Truth only. Unknown information remains explicit rather than fabricated.

### Job Sources / Live Search / Feed / deduplication
Connector abstraction, provenance and source registry; canonical observations, feed state, deterministic duplicate/repost handling and admin source disablement. The search UI covers an official Polish aggregate API plus Pracuj.pl, LinkedIn Jobs, OLX Praca, Indeed, RocketJobs, Just Join IT and direct employer career pages. Search criteria are prefilled from Career Truth.

**Jooble Polska** is implemented as an `OFFICIAL_API` connector. When `JOOBLE_API_KEY_PL` is configured, Job queries Jooble's documented Polish REST endpoint, maps the response to the existing source model and sends the results through the same parser, Decision Engine and per-user dedup pipeline. The API key remains environment-only and is not written to source provenance or logs. A 30-minute query cache limits repeated requests. Missing/rejected keys and rate limits fail only this source.

For the six direct public job boards, Job additionally attempts a bounded automatic read of public result/detail pages, extracts Schema.org `JobPosting` when present, normalizes the records through the existing parser and Decision Engine, then feeds them through the same canonical dedup pipeline. Each source is isolated: 401/403/429, CAPTCHA/human-verification, layout changes or HTTP failures do not stop Jooble or the remaining sources. The adapter does not log in, use private credentials, bypass CAPTCHA/rate limits, or use private endpoints. Runtime source status is visible in the UI; the official search URL remains a manual fallback. Direct employer career pages still require explicit allowlist/feed configuration. Detailed boundaries are documented in `docs/FEDERATED_JOB_SEARCH.md`.

### Bottleneck Engine
Evidence-limited funnel diagnostics with shared confidence vocabulary: `ZA_MALO_DANYCH`, `WCZESNY_SYGNAL`, `PRAWDOPODOBNY_WNIOSEK`, `SILNY_WNIOSEK`. Tiny samples cannot become strong diagnoses.

### Local Labour Intelligence
Sourced official/public-data snapshot model, guarded official HTTPS imports, nearby-area links, comparable evidence and uncertainty. Scheduled national data acquisition/refresh remains an operational data task.

### Effective Wage
Optional offer decision aid with explicit salary/commute assumptions. Subjective value of time is separate and never presented as objective economics.

### Skill ROI
Ranks learning candidates from confirmed user skills, requirements observed in saved jobs, available local-market evidence and explicit cost/time/certification assumptions. Missing Career Truth means **not confirmed**, not **does not possess**. “Jobs unlocked” means only observed saved offers where the skill is the sole unconfirmed MUST_HAVE requirement. Confidence is always shown.

### Just-in-Time Learning
Creates bounded 15/30/60/120-minute preparation plans tied to a real interview, missing skill, certification topic or job requirement. It is not a course marketplace and never claims certification beyond recorded facts.

### Career Transition
Curated adjacent-role graph plus user-specific evidence: confirmed transferable skills, unconfirmed requirements, saved target jobs, local evidence, observed salary range, transition difficulty, suggested learning and confidence. The graph is a navigation aid, not exhaustive occupational truth. Explored paths can be persisted.

### Outcome Inbox
A user-pasted recruitment message can create a pending structured suggestion for rejection, interview, offer or recruiter contact. **Raw message text is not stored**: persistence contains a SHA-256 message hash, generic evidence codes, confidence and source metadata. Classification alone never changes an application. Explicit confirmation transactionally changes the application status and records a user-confirmed outcome; dismissal changes no recruitment outcome. Provider-backed mailbox integration remains optional/deferred.

### Strategy Engine
Activates only after at least 10 applied-or-beyond applications. Segment comparisons require at least 5 observations per compared segment. It can propose at most three bounded experiments using the user's own role/contract/freshness history plus already-grounded Local Labour and Skill ROI signals. Every recommendation exposes sample size, confidence, evidence and caveats. Accepted/dismissed recommendations are persisted; accepted experiments also create an intervention boundary for later outcome comparison. The engine never silently changes Career Truth, desired roles, contract preferences or commute radius.

## Privacy and data-flywheel readiness

The user export includes core data plus Today actions, notification settings/items, Job Feed observations/state, Effective Wage assumptions, Skill ROI assumptions, Learning sessions, Career Transition explorations, privacy-minimized Outcome Inbox suggestions, Strategy decisions and user interventions. User-owned records are removed through user-scoped operations/foreign-key cascades.

The schema supports the candidate-side loop:

`job → decision → action → application → outcome → intervention → later outcome → better recommendation`

No cross-user recommendation model is active.

## Executable migrations

CI validates sequential SQLite migrations:

- `0001_init.sql`
- `0002_hardening.sql`
- `0003_analytics_consent.sql`
- `0004_portable_upload_storage_keys.sql`
- `0005_today_actions.sql`
- `0006_notifications.sql`
- `0007_job_sources_feed.sql`
- `0008_bottleneck_flag.sql`
- `0009_local_labour_intelligence.sql`
- `0010_effective_wage.sql`
- `0011_skill_roi_learning.sql`
- `0012_career_transition.sql`
- `0013_outcome_inbox.sql`
- `0014_strategy_engine.sql`
- `0015_federated_job_search.sql`
- `0016_live_public_job_ingestion.sql`
- `0017_jooble_official_api.sql`

`postgres_0001_reference.sql` remains a production-target reference, not evidence of a completed PostgreSQL production migration.

## Feature flags

Large features are disabled by default and support controlled 0/10/50/100 rollout with immediate rollback. Current post-MVP keys include Today, Notifications, Interview Pack, Job Feed (including official-API and live multi-source search), Bottleneck, Local Labour, Effective Wage, Skill ROI, Just-in-Time Learning, Career Transition, Outcome Inbox and Strategy Engine.

## Automated quality gate

The branch CI gates locked dependency installation, policy lint, strict server/client/E2E TypeScript, sequential migration validation, Node unit/API/security tests, ownership/feature-gate/uncertainty/confirmation tests, semantic backup/restore, Playwright Chromium mobile+desktop, axe accessibility checks, production Docker build and a booted-container `/api/health` smoke.

The branch must not be merged until its latest full CI run is green.

## Genuine external gates still open

These cannot be truthfully completed from repository code alone:

1. live staging and chosen production-environment evidence;
2. representative-user first-value study proving the `<3 min` target and usefulness;
3. closed-beta outcome capture, D7/D30 retention and paid-conversion evidence;
4. final legal review: controller/contact identity, legal bases, subprocessors/transfers, retention schedule and production Terms/Privacy;
5. live payment-provider lifecycle and BLIK where practical;
6. production PostgreSQL/private object storage migration if selected for the chosen scale/topology;
7. managed encrypted off-host backups/restore drills and production monitoring/alerting;
8. live required malware scanner in the chosen hosting architecture;
9. manual assistive-technology/WCAG 2.2 AA review;
10. penetration/security review before broad public launch;
11. a user-owned Polish Jooble API key must be provisioned in the deployment environment for that official connector to become live;
12. production review of each remaining third-party source's current terms/licensing plus monitoring for layout/access-policy changes; site-specific official API/feed/partnership remains preferred where available;
13. broad scheduled public-market data refresh and direct-employer allowlist/feed operations;
14. PWA product-market-fit evidence before native mobile;
15. privacy/legal/fairness review before any cross-user intelligence.

These are external gates, not fabricated as completed work.
