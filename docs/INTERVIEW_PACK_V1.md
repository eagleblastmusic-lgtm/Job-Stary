# Interview Pack V1

## Scope

Interview Pack V1 is a feature-gated preparation surface generated on demand from an existing user-owned application, the parsed job offer, the current profile and Career Truth.

It includes:
- company and role summary grounded in the saved offer;
- key requirements;
- strongest confirmed candidate arguments;
- explicit information gaps;
- likely interview questions;
- answer frameworks;
- questions to the employer;
- salary preparation;
- a small role/requirement-oriented mini-test;
- a preparation checklist.

## Truth boundary

The pack never turns an `INFERRED` Career Truth fact into a confirmed candidate claim. If a job requirement is not confirmed in Career Truth, the UI says that the application does not have confirmation; it does not claim that the user lacks the skill.

Answer frameworks explicitly ask the user to choose a real example and not invent actions, results, numbers, experience or achievements. Generation is read-only with respect to Career Truth: opening an Interview Pack does not create or confirm career facts.

## Ownership and rollout

- disabled by default behind `interview_pack`;
- user-scoped application lookup;
- foreign and nonexistent application IDs intentionally expose the same 404 contract;
- no autonomous status changes;
- no recorded interview date is fabricated.

## Evidence

Unit/domain tests prove confirmed-vs-inferred behavior and truth-boundary wording. API tests cover feature gating and ownership. Playwright/axe covers the mobile and desktop Interview Pack surface.
