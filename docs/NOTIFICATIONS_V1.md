# Notifications V1

## Scope

Notifications V1 is a feature-gated, in-app notification center. It is intentionally limited to reminders grounded in application/job state already stored in Job.

Implemented reminder classes:
- follow-up after sufficient waiting time on an application;
- approaching application deadline.

Preferences are already persisted for interview reminders and future matched-job alerts, but those generators stay inactive until their required source data exists. The system does not fabricate interview dates or matching events.

## Product rules

- useful notifications only;
- calm language, no streaks, shame or panic mechanics;
- deterministic deduplication so the same reminder is not repeatedly recreated;
- user-scoped read/dismiss operations;
- disabled-by-default feature flag and staged rollout;
- external email/SMS/push delivery is not part of V1 and is not claimed as configured.

## Evidence

Server/API tests cover generation, deduplication, preferences, ownership and export. Playwright/axe covers the mobile/desktop notification surface. Production authentication rate limits are tested separately; feature-UI tests use controlled authenticated fixtures so they do not consume shared registration budgets.
