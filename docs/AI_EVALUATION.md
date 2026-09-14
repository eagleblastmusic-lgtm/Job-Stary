# AI Gateway and evaluation

The MVP core does not require an LLM to make its first Decision Card. This is deliberate: deterministic rules are used where they are more reliable.

All future LLM calls must pass through `src/server/aiGateway.ts`, which records:

- task type,
- model,
- prompt version,
- input hash,
- output schema name,
- latency,
- token usage when supplied,
- success/failure.

Raw CV content must not be written to generic analytics.

## Evaluation suite roadmap

Create a versioned Polish dataset containing legally usable/synthetic profiles and manually labelled offers. Measure extraction precision/recall, missing-field rate, requirement classification, grounded decision explanations and unsupported CV claim rate. Unsupported career claims have an effective-zero target.

Current executable automated guard: CV generation tests prove that `INFERRED` facts are excluded until confirmed.
