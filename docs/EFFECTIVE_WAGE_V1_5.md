# Effective Wage — V1.5

## Purpose

Effective Wage is an optional candidate-side decision aid. It helps compare an offer's stated pay with explicit commuting costs and time. It does not decide whether the user should accept or reject a job.

## Inputs

The calculator can use:
- salary range and salary period parsed from a saved job;
- whether the offer says gross or net;
- user-entered round-trip commuting distance;
- user-entered commuting minutes per day;
- commuting days per month;
- user-entered vehicle/travel cost per kilometre;
- monthly work hours;
- optional user-entered gross-to-net ratio;
- optional user-entered subjective value of one hour of personal time.

Shift/night/weekend information is shown as context. V1.5 does not silently assign a monetary value to nights, weekends or a shift pattern.

## Gross-to-net boundary

This is **not a tax calculator**. If the saved offer is marked NET, the stated amount can be used as net. If it is marked GROSS, net is only estimated when the user explicitly supplies a gross-to-net ratio. If gross/net is unknown, or the ratio is absent, the calculator returns an unknown net result instead of guessing.

The UI labels the ratio as a user assumption and explicitly says it is not tax or financial advice.

## Commute cost

Monthly commuting cash cost is calculated only when both values exist:

`round-trip km × user cost/km × commuting days/month`

If either distance or cost/km is missing, monthly commute cash cost remains unknown.

## Time-value boundary

Commuting time is calculated independently from money. The optional subjective time value is kept in a separate result section and is never presented as objective salary or objective economic value.

The primary cash result is:

`estimated net - explicit commuting cash cost`

Only when the user has explicitly provided a personal time-value rate is an additional subjective view computed:

`cash after commute - commute hours × user time-value rate`

## Safety and ownership

- feature-gated behind `effective_wage`, disabled by default;
- settings and job access are user-scoped;
- foreign and nonexistent job IDs expose the same not-found contract;
- no tax, legal or financial-advice claim;
- missing information produces an explicit warning instead of a fabricated estimate.

## Evidence

Domain tests cover gross/net uncertainty, commute cost, monthly conversion and separation of subjective time value. API tests cover feature gating, persistence and user ownership. Browser/axe tests cover the assumptions form, calculation output, explicit warnings and accessible mobile/desktop rendering.
