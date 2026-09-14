# Skill ROI + Just-in-Time Learning — V1.5

## Skill ROI boundary

Skill ROI answers a narrow question: which not-yet-confirmed skill appears most promising to investigate next, given the user's own saved job sample, Career Truth and available local evidence.

It does not estimate a guaranteed return. A skill absent from Career Truth is labelled **not confirmed**, never automatically **not possessed**. `NOT_POSSESSED` is used only when the user explicitly recorded that fact.

A job is counted as potentially unlocked by a candidate skill only when that skill is the only not-confirmed `MUST_HAVE` requirement in that saved job. This is still a candidate-side heuristic, not a guarantee that the employer will accept the application.

Salary comparisons are shown only for comparable monthly salary records with the same gross/net context and sufficient observations. Unknown salary context remains unknown. Local-market evidence is sourced from the existing normalized official snapshots; missing public evidence reduces confidence.

Cost, learning time and whether formal certification is required are user-controlled assumptions. If cost or time is missing, the application does not calculate a financial ROI.

## Just-in-Time Learning boundary

The learning surface is deliberately not a course marketplace. It creates 15, 30, 60 or 120 minute preparation plans tied to a real target already present in user data:

- an application currently at interview stage;
- a recurring not-confirmed skill from Skill ROI;
- a user-marked certification target;
- a `MUST_HAVE` requirement from a saved job.

Plans structure preparation and practice. They do not teach unverified factual content, certify the user, or write new Career Truth facts. Certification rules and external subject-matter facts must be checked against an appropriate authoritative source.

## Rollout and evidence

Both surfaces are disabled by default behind deterministic feature flags. Mutation endpoints are same-origin protected and user-scoped. Domain/API tests cover uncertainty, explicit assumptions and bounded learning plans. Playwright/axe covers the main screens on the existing mobile/desktop CI matrix.
