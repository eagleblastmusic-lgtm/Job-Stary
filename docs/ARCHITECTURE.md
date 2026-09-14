# Architecture overview

## Shape

Job is a candidate-side **modular monolith**:

```text
src/domain   — pure/testable business rules and confidence/decision engines
src/server   — HTTP, auth, persistence, uploads, PDF, feature routing and integration boundaries
src/client   — browser orchestration and progressive feature UI
public       — PWA shell and design system
migrations   — reproducible executable SQLite schema
```

Business rules do not live in presentation code. The web/PWA client consumes server APIs; later native clients are expected to reuse the same domain/API contracts rather than rebuild career logic.

## Core invariants

- **Career Truth:** inferred/unknown information never becomes a confirmed user fact automatically.
- **CV Engine:** only confirmed, CV-allowed Career Truth enters generated documents.
- **Job Parser:** deterministic Polish parsing first; uncertainty is preserved.
- **Decision Engine:** evidence-based and explainable; recommendations can be overridden by the user.
- **Sensitive-data firewall:** matching/recommendations do not use protected traits or unrelated sensitive data.
- **Candidate-side boundary:** no employer-side candidate ranking exists in this roadmap.
- **AI Gateway:** the only permitted boundary for future model-provider calls; deterministic critical paths do not require an LLM.

## Feature architecture

Large later-stage capabilities use persisted feature flags with deterministic 0/10/50/100 rollout and fail-closed rollback.

### Daily execution layer

- `TodayService` / Action Priority ranks candidate actions rather than only jobs.
- Notifications derive bounded, actionable reminders from tracker/job state.
- Interview Prep uses the saved application/job plus confirmed Career Truth.

### Opportunity and market layer

- Job source connectors normalize observations behind a legal-source boundary.
- Job Feed separates canonical jobs from source observations/reposts.
- Bottleneck Engine measures only funnel stages supported by recorded data.
- Local Labour Intelligence combines user location/commute with sourced official snapshots.
- Effective Wage keeps explicit cash assumptions separate from subjective time value.

### Learning and transition layer

- Skill ROI derives candidates from confirmed skills plus observed saved-job requirements and user assumptions.
- Just-in-Time Learning creates bounded 15/30/60/120-minute plans tied to a real target.
- Career Transition uses a curated adjacent-role graph, then overlays user-specific confirmed skills, gaps and observed market evidence.

### Outcome and strategy layer

- Outcome Inbox stores a classification as a **pending suggestion**. Classification alone cannot mutate application state. Explicit user confirmation performs the application/outcome update transactionally.
- Strategy Engine reads the user's own historical funnel. A minimum evidence threshold prevents recommendations from tiny samples; emitted recommendations are bounded experiments with confidence/sample size, not causal career decisions.

## Persistence and user ownership

The executable runtime currently uses `node:sqlite`. Schema is advanced only through ordered migrations. User-owned records are scoped by `user_id` or ownership joins and are included in export/deletion boundaries.

Current later-stage persistence includes:

- feature flags and daily actions;
- notification preferences/items;
- job source observations/feed state;
- local-labour snapshots and area links;
- Effective Wage preferences;
- Skill ROI assumptions and Learning sessions;
- Career Transition explorations;
- Outcome Inbox suggestions.

The candidate-side historical schema supports the data-flywheel sequence without enabling cross-user learning:

```text
job → decision → action → application → outcome → intervention → later outcome → recommendation
```

## Security boundaries

- opaque server-side sessions with HttpOnly cookies;
- same-origin/Fetch Metadata mutation checks;
- security headers and no-store API responses;
- bounded inputs;
- private portable upload keys, traversal/signature/MIME/size validation;
- malware-scanner interface with required fail-closed deployment mode;
- audit logging for sensitive/operator actions;
- analytics consent and filtering of raw professional content.

## Deployment boundary

SQLite/local private storage is an explicit first-runtime choice suitable for a single-instance or controlled test environment. Managed PostgreSQL, private object storage, production monitoring, distributed rate limiting where needed and off-host encrypted backups belong to the production topology gate.

## Post-V2 gates

### Native V2.5

The Master Plan explicitly requires PWA product-market-fit evidence before React Native/Expo work. Until that gate passes, native is intentionally deferred. Domain/API separation exists so native can reuse logic later.

### Cross-user V3

No cross-user recommendation intelligence is active. Implementation requires prior privacy/legal approval plus aggregation, minimum cohorts, privacy model, fairness monitoring and confidence safeguards. Identifiable user outcomes must never be exposed.
