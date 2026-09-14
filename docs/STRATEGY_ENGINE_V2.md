# Strategy Engine — V2

Strategy Engine activates only after the user has at least 10 sent applications. It uses only that user's recorded history plus already-available candidate-side modules; it does not compare the user with other people.

## Recommendation classes

The engine may propose a small measurable experiment when evidence supports it:

- temporarily increase the share of a better-performing role,
- temporarily increase the share of a better-performing contract type,
- prioritize fresh offers when the user's own fresh-vs-older samples differ materially,
- test a sourced +10 km labour-market opportunity surfaced by Local Labour Intelligence,
- verify learning a recurring skill surfaced by Skill ROI,
- use a more selective high-fit application experiment when response is low and no more specific signal is sufficiently supported.

At most three recommendations are shown at once.

## Evidence rules

- No strategy recommendations below 10 sent applications.
- Segment comparisons require at least 5 applications in each compared segment.
- Confidence uses the shared Bottleneck vocabulary: `ZA_MALO_DANYCH`, `WCZESNY_SYGNAL`, `PRAWDOPODOBNY_WNIOSEK`, `SILNY_WNIOSEK`.
- Role/contract/freshness comparisons are explicitly described as observational correlation, not causation.
- Radius recommendations are reused only when Local Labour Intelligence has a sourced `MAY_HELP` signal.
- Skill recommendations are reused only when Skill ROI is above `ZA_MALO_DANYCH`, has at least five observed requirements and at least one saved job where the skill is the sole unconfirmed MUST_HAVE gap.
- The engine does not recommend a wholesale CV-narrative change from low response alone; there is not enough causal evidence for that claim.

## Data flywheel

The user can accept or dismiss a recommendation. The decision is persisted in `strategy_decisions`; accepted recommendations also create a `STRATEGY_EXPERIMENT` intervention. This gives later analysis a user-confirmed intervention boundary:

`job → decision → application → outcome → intervention → later outcome`

The engine never silently edits the user's Career Truth, desired roles, contract preferences or commute radius.

## Cross-user boundary

V2 is strictly per-user. Cross-user aggregation, cohort intelligence or benchmarks remain disabled until the separate privacy/legal review required by the Master Plan.
