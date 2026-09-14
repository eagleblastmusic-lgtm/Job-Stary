# Job V2 — release notes

Date: 2026-09-13

## Scope completed

This release line completes repository implementation from the existing MVP/V1 baseline through V1.5 and V2.

### V1.5

- Local Labour Intelligence with sourced official/public evidence and guarded imports.
- Effective Wage with explicit user assumptions and separately labelled subjective time value.
- Skill ROI with observed-saved-job unlock logic, cost/time/certification assumptions and shared confidence vocabulary.
- Just-in-Time Learning plans for 15/30/60/120 minutes tied to real targets.

### V2

- Career Transition Engine with an adjacent-role graph, confirmed transferable skills, unconfirmed gaps, observed target jobs/local evidence, salary range, difficulty, suggested learning and confidence.
- Outcome Inbox with cautious deterministic classification, **no persisted raw message text**, and mandatory user confirmation before any tracker/outcome mutation.
- Strategy Engine with a 10-application activation gate, 5-observation segment floors, role/contract/freshness comparisons, sourced radius/Skill ROI signals, maximum three bounded experiments and persisted accept/dismiss decisions.
- Candidate-side data-flywheel hooks: accepted Strategy experiments create intervention boundaries for later outcome comparison.
- Complete V2 personal-data export for newly persisted user-owned records, including privacy-minimized Outcome Inbox suggestions and Strategy decisions/interventions.

## Safety and product invariants

- no invented Career Truth;
- missing skill/credential evidence means “not confirmed”, never automatic absence;
- no auto-apply;
- no employer-side candidate ranking;
- no unauthorized scraping;
- no silent Outcome Inbox state changes;
- no raw recruitment-message body persisted by Outcome Inbox;
- no Strategy recommendations below the minimum sample gate;
- segment recommendations require meaningful per-segment samples and are labelled observational, not causal;
- no cross-user intelligence;
- large features remain feature-gated and disabled by default.

## Quality gate

The release is gated by policy lint, strict TypeScript, sequential migrations, Node unit/API/security tests, semantic backup/restore, Playwright mobile+desktop, axe accessibility checks, production Docker build and running-container health smoke.

## Deferred by explicit roadmap gates

- native React Native/Expo application until PWA product-market-fit evidence;
- cross-user data moat/intelligence until privacy/legal/fairness approval;
- optional provider mailbox integration for Outcome Inbox;
- broad scheduled public labour-data acquisition/source partnerships;
- live billing/provider integration and final production infrastructure evidence.

See `IMPLEMENTATION_STATUS.md` and `docs/PRODUCTION_READINESS.md` for the authoritative completion boundary.
