# Local Labour Intelligence V1.5

## Purpose

Local Labour Intelligence answers three bounded questions from the Master Plan:

1. where the user currently has the strongest evidence of opportunity,
2. whether extending the commute radius by up to 10 km may expose a stronger nearby market,
3. whether a target occupation has a different demand/supply signal in a nearby area.

It is an evidence view, not a promise of employment and not a causal model.

## Evidence model

The feature keeps two evidence classes separate:

- **user-observed supply** — canonical jobs already stored in the user's own Job database;
- **public labour-market evidence** — normalized snapshots imported from approved official sources.

V1.5 accepts public snapshots from:

- `BAROMETR_ZAWODOW` — occupational shortage/balance/surplus evidence and occupational statistics;
- `GUS_BDL` — official local statistics through Statistics Poland / Bank Danych Lokalnych;
- `OTHER_OFFICIAL` — only HTTPS sources on Polish government/statistics/public-employment domains.

Every snapshot stores source URL, source name, year, optional source update date and licence. GUS BDL data should retain `CC BY 4.0` attribution metadata.

There is intentionally no unauthorized scraper. Barometr records can be normalized by a controlled import process from the official publication/data module. GUS BDL has an official REST API; a later ingestion worker may automate those normalized imports without changing the decision contract.

## Geography

The current Career Profile provides:

- base `location`,
- `commute_km`.

Nearby-area relationships are stored separately with a source URL and a reference distance. The engine never invents a distance from two place names. Only sourced area links can participate in the commute comparison.

The `+10 km` question is evaluated only when:

- the user has a commute tolerance,
- a sourced neighbouring-area link falls between the current radius and current radius + 10 km,
- that candidate has public evidence,
- its comparable evidence is stronger than the best area already inside the user's radius.

Otherwise the UI says that no strong signal is available.

## Comparison rules

No opaque percentage is shown. Areas are ordered deterministically by:

1. occupational shortage class (`BIG_DEFICIT` → `DEFICIT` → `BALANCE` → `SURPLUS` → `UNKNOWN`),
2. one comparable reference offer-flow channel, preferring Internet, then CBOP, then PUP,
3. number of matching canonical jobs in the user's own stored set.

PUP, CBOP and Internet counts are **not summed**, because their coverage may overlap.

## Confidence

The shared product vocabulary is used:

- `ZA_MALO_DANYCH` — no public source for the area/role;
- `WCZESNY_SYGNAL` — only stale public evidence;
- `PRAWDOPODOBNY_WNIOSEK` — current public evidence is available;
- `SILNY_WNIOSEK` — at least two current official sources provide both a demand/supply classification and a comparable offer-flow signal.

Even a strong evidence label describes confidence in the market comparison, not an individual's probability of getting a job.

## Credentials

A public snapshot may list relevant credentials. The engine compares them only with confirmed credentials in Career Truth. A missing match is worded as **"nie mamy potwierdzenia"**, never as a claim that the user lacks the qualification.

## Security and provenance

- feature is disabled by default behind `local_labour`;
- public data imports are admin-only;
- mutating admin endpoints enforce same-origin checks;
- source URLs are restricted to HTTPS official domains;
- all admin imports are audit logged;
- no raw CV content is copied into market snapshots;
- user analytics store only confidence, number of compared areas and the radius signal.

## Sources verified during implementation

- Statistics Poland BDL API documentation: official REST JSON/XML API, local territorial levels and CC BY 4.0 reuse terms.
- Barometr Zawodów: official county/province/national forecasts plus occupational statistics such as registered unemployed and job-offer inflows; data module states the statistics come from CeSAR.

The application should show the original source metadata alongside conclusions so later data-refresh automation can remain auditable.
