# First Decision Card acceptance

## Goal

The MVP target is that a candidate can reach the first useful Decision Card on the happy path in under 3 minutes.

This repository separates two kinds of evidence so that automated speed is not confused with human usability.

## 1. Technical browser gate

GitHub CI runs `e2e/time-to-first-decision.spec.ts` on the configured mobile and desktop Chromium projects.

The timed path includes:
- opening the application,
- account registration and required legal consent,
- minimal profile setup,
- one confirmed Career Truth credential,
- pasting a representative Polish job offer,
- receiving a rendered Decision Card.

The test fails when the elapsed browser time exceeds 180,000 ms and prints `FIRST_DECISION_TECHNICAL_MS=<value>` to the CI log.

This proves that the implemented application path itself can complete inside the target under automated conditions. It does **not** prove that representative users understand the interface or can complete the task in under 3 minutes.

## 2. Human usability acceptance

The product acceptance gate remains open until representative users complete the same happy-path task without developer assistance.

For each session record only the minimum evidence needed for product validation:
- test date,
- device class: mobile or desktop,
- start timestamp,
- Decision Card visible timestamp,
- elapsed time,
- whether assistance was required,
- short blocker/observation notes without CV content, job-offer text, e-mail address or other unnecessary personal data.

Use the same functional scope as the technical test: registration, minimal profile, one true Career Truth fact, one pasted offer and the first Decision Card.

A session should not be counted as evidence for the under-3-minute happy path when the tester needed direct instruction about where to click or what a field means. Record such a session as a usability finding instead.

## Evidence handling

Do not commit real candidate CVs, account credentials, pasted private job content or identifying participant data to the repository. Store only aggregate or de-identified acceptance results.

## Current status

- Technical browser gate: implemented in CI.
- Representative-user time-to-value acceptance: pending.
