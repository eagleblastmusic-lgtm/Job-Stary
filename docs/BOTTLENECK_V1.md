# Bottleneck Engine V1

## Purpose

Bottleneck V1 answers a narrow question: **at which recorded stage of the candidate-side process is there currently the strongest evidence of friction?** It does not claim a causal explanation and does not make sweeping career decisions from a small sample.

## Stages

The shared stage vocabulary is:
- MARKET
- DISCOVERY
- FIT
- ACTION
- RESPONSE
- INTERVIEW
- LATE_STAGE
- OFFER

V1 can quantify FIT, ACTION, RESPONSE, INTERVIEW and LATE_STAGE from the user's own recorded jobs, Decision Cards, applications and outcomes. MARKET/DISCOVERY require broader market/source coverage and therefore are not fabricated from incomplete data.

## Confidence vocabulary

User-facing confidence is standardized as:
- `ZA_MALO_DANYCH` → **ZA MAŁO DANYCH**
- `WCZESNY_SYGNAL` → **WCZESNY SYGNAŁ**
- `PRAWDOPODOBNY_WNIOSEK` → **PRAWDOPODOBNY WNIOSEK**
- `SILNY_WNIOSEK` → **SILNY WNIOSEK**

V1 thresholds are deliberately conservative:
- fewer than 5 denominator observations: no diagnosis;
- 5–9: early signal;
- 10–29: probable conclusion;
- 30+: strong conclusion.

A threshold only controls language strength. It does not turn an observational correlation into causality.

## Every diagnosis includes

- stage;
- sample size;
- confidence;
- observed rate when defined;
- evidence;
- multiple alternative explanations;
- one cautious recommended next action.

The engine explicitly avoids statements such as “Twoje CV jest złe” from a tiny sample. RESPONSE alternatives, for example, include employer timing, incomplete tracker outcomes, source/freshness and market competition before any CV hypothesis.

## Data boundary

Metrics are computed only from records owned by the authenticated user. The report is generated on demand and is not persisted as a new Career Truth fact. Missing application outcomes reduce confidence rather than being guessed.

## Rollout

The surface is disabled by default behind the `bottleneck` feature flag and uses the same deterministic internal/10%/50%/100% rollout infrastructure as other large features.

## Evidence

Domain tests cover sample thresholds, confidence levels, primary-stage selection and non-causal wording. API tests cover fail-closed feature gating. Playwright/axe covers sample size, confidence, evidence, alternative explanations, next action and accessibility on the user-facing screen.
