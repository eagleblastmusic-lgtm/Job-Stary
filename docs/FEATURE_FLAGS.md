# Feature flags and staged rollout

Large post-MVP capabilities are shipped behind persisted feature flags before exposure to users. Current keys:

- `today`
- `notifications`
- `interview_pack`
- `job_feed`
- `bottleneck`
- `local_labour`
- `effective_wage`
- `skill_roi`
- `just_in_time_learning`
- `career_transition`
- `outcome_inbox`
- `strategy_engine`

## Rollout model

Allowed rollout percentages are deliberately discrete: `0`, `10`, `50`, `100`.

- `enabled=false` — immediate rollback; nobody receives the feature, including administrators.
- `enabled=true, rollout=0` — internal mode; persisted `ADMIN` users receive the feature, normal users do not.
- `enabled=true, rollout=10|50` — normal users are assigned deterministically using a stable `feature:user` bucket, while administrators remain included.
- `enabled=true, rollout=100` — all authenticated users receive the feature.

The same user remains in the same bucket across requests/restarts, so staged rollout does not flicker.

## Operator command

Until the protected admin UI is expanded, flags can be changed only from an operator environment with direct database access:

```bash
DATABASE_PATH=/app/data/job.sqlite npm run feature:flag -- today on 10
DATABASE_PATH=/app/data/job.sqlite npm run feature:flag -- outcome_inbox on 10
DATABASE_PATH=/app/data/job.sqlite npm run feature:flag -- strategy_engine off 0
```

The command validates key/rollout level, updates the flag transactionally and records the operator change in `audit_logs`.

A flag being technically enabled does not close a product acceptance gate. Real-usage, legal, provider and PMF gates require separate evidence.
