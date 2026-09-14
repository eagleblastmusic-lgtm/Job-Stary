# Production readiness checklist

Status date: 2026-09-13

This checklist separates repository readiness from external production acceptance.

## Repository / CI — required before merge

- [x] TypeScript strict checks for server, client and E2E.
- [x] Static policy lint.
- [x] Sequential executable SQLite migrations.
- [x] Unit/API/security test suites for critical flows and post-MVP engines.
- [x] User ownership checks on protected resources.
- [x] Feature flags default-off for large post-MVP features.
- [x] Career Truth grounding rules and unsupported-claim protections.
- [x] Today / Action Priority and useful in-app Notifications.
- [x] Interview Prep Pack.
- [x] Job Source connector boundary, Feed and deduplication.
- [x] Bottleneck Engine and confidence vocabulary.
- [x] Local Labour Intelligence and Effective Wage.
- [x] Skill ROI and Just-in-Time Learning.
- [x] Career Transition Engine.
- [x] Outcome Inbox confirm-before-write boundary.
- [x] Strategy Engine small-sample guard.
- [x] Personal-data export includes V2 persisted user data.
- [x] Account deletion and cascade model.
- [x] Backup/restore portability exercise in CI.
- [x] Browser E2E on mobile and desktop profiles.
- [x] Automated axe checks on critical/new screens.
- [x] Production Docker build and boot health smoke in CI.
- [ ] Latest branch CI run green — final merge gate; verify after the last commit.

## Security / privacy — repository controls

- [x] scrypt passwords, opaque hashed sessions and HttpOnly cookies.
- [x] Same-origin mutation controls and Fetch Metadata checks on main API paths.
- [x] CSP, frame, referrer, permissions and resource-isolation headers.
- [x] Production HSTS header.
- [x] Bounded request/data inputs.
- [x] Private portable upload keys and traversal protection.
- [x] MIME/signature/size validation.
- [x] Malware scanner boundary with required fail-closed mode support.
- [x] No raw CV content in generic product analytics.
- [x] Optional analytics consent persistence.
- [x] Audit records for sensitive operator/user actions.
- [x] No unauthorized scraping implementation.
- [x] No employer-side ranking or protected-trait matching.
- [x] Outcome Inbox never updates status from classification alone.
- [x] Strategy Engine does not recommend strategy changes from fewer than 10 applied-or-beyond applications.

## External gates — not satisfiable by repository code alone

- [ ] Final production controller/contact identity and legal review.
- [ ] Final Terms/Privacy, legal bases, subprocessors/transfers and retention schedule.
- [ ] Live staging deployment evidence after the final release candidate.
- [ ] Production hosting decision and infrastructure review.
- [ ] Live required malware scanner installation/evidence.
- [ ] Managed monitoring/alerting and incident-response ownership.
- [ ] Encrypted off-host backup policy and live restore drill.
- [ ] Production PostgreSQL/object storage migration if required for chosen scale/topology.
- [ ] Distributed/shared rate limiting if horizontally scaled.
- [ ] Live payment provider lifecycle; recurring method and BLIK for one-time purchase where practical.
- [ ] Manual assistive-technology / WCAG 2.2 AA review.
- [ ] Penetration/security review before broad public launch.
- [ ] Representative-user `<3 min` first-value evidence.
- [ ] Closed-beta outcome capture, retention and paid-conversion evidence.
- [ ] Source licences/partnerships and scheduled local-labour data refresh coverage.

## Roadmap gates after V2

### V2.5 native mobile

Status: **BLOCKED BY PRODUCT GATE, not missing repository implementation.** The Master Plan says to build React Native/Expo only after PWA product-market fit. No PMF evidence has been produced yet. Domain logic is kept server/domain-side so it can be reused later rather than reimplemented.

### V3 cross-user intelligence

Status: **BLOCKED BY PRIVACY/LEGAL GATE.** Before implementation/rollout the project needs an approved aggregation/cohort design, minimum cohort size, privacy model, fairness monitoring, confidence thresholds and a rule preventing identifiable user-outcome exposure.

## Release decision

A green repository CI run is sufficient to merge the V2 implementation branch, but **not** sufficient to declare broad public production launch. Broad launch requires the external gates above to be closed with evidence.
