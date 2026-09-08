# MUJIFX Step 13H — Vintage Strategy and Source-Compliance Gate

Status: **DESIGN COMPLETE — FRED/ALFRED archival backfill BLOCKED by source terms.**

## 1. Important course correction

Step 13G successfully proved that FRED/ALFRED vintage discovery, point-in-time retrieval, and the MUJIFX vintage database mechanics work.

However, before implementing production archival ingestion, the FRED API Terms of Use must be respected. The current FRED terms explicitly prohibit using the FRED API for storing, caching, or archiving FRED content or incorporating FRED content into a database/archive, except where expressly permitted. They also restrict use of FRED API content for development/training of AI systems.

Therefore MUJIFX must **not** proceed with a full FRED/ALFRED vintage backfill into `indicator_observation_vintages` under the current API-based design.

This is a better engineering decision than building a technically correct system on a source contract that does not permit the intended storage model.

Official FRED terms: https://fred.stlouisfed.org/docs/api/terms_of_use.html

## 2. What remains valid from Step 13G

The following architectural lessons remain valid:

- a point-in-time dataset is required for unbiased historical fundamental analysis;
- `observation_date` and information-availability date must be separated;
- historical analysis must never use today's revised value when reconstructing an earlier date;
- initial release, later revision, and current value are different states;
- an atomic vintage writer is technically sound;
- the pilot demonstrated correct open/closed vintage behavior.

The existing pilot rows should **not be expanded** until the project's source/data-rights decision is resolved.

## 3. New production rule

The production MUJIFX database may only archive historical/vintage observations from a provider whose terms explicitly permit the intended storage/use, or from data files obtained under a license that permits local/database storage.

For every source we add, we must verify:

1. API/data-access permission;
2. archival/storage permission;
3. redistribution/display permission if the data will appear in the public app;
4. revision/vintage availability;
5. attribution requirements;
6. rate limits;
7. whether AI/LLM processing is permitted.

Do not infer permission merely because an API is free or public.

## 4. Source migration direction

The project should move the authoritative acquisition layer away from FRED for data that MUJIFX intends to store.

### BLS-origin indicators

Prefer the authoritative BLS source for:

- CPI
- CORE_CPI
- PPI
- NFP / payroll employment
- UNEMPLOYMENT_RATE
- AVG_HOURLY_EARNINGS
- INITIAL_JOBLESS_CLAIMS
- CONTINUING_CLAIMS
- JOLTS

BLS states that its public data can be downloaded and used for secondary analysis, while requiring appropriate citation and preserving the distinction that BLS cannot vouch for downstream analyses after retrieval.

Official BLS terms: https://www.bls.gov/developers/termsOfService.htm
Official BLS API: https://www.bls.gov/bls/api_features.htm

### BEA-origin indicators

Prefer the authoritative BEA source for:

- PCE
- CORE_PCE
- GDP / GDP growth
- other BEA-origin macro series added later

BEA provides an official API for programmatic retrieval of published economic statistics. Its API registration requires agreement to the published terms of service, so the project's final storage policy must be checked against those terms before archival implementation.

Official BEA API: https://apps.bea.gov/api/signup/

### Federal Reserve / Treasury / CBOE-origin indicators

For:

- FED_FUNDS_RATE
- TREASURY_2Y
- TREASURY_10Y
- BROAD_DOLLAR_INDEX
- VIX

use the authoritative originating provider where a storage-permitting machine-readable source is available. FRED may remain a discovery/reference layer, but it should not automatically become the archival source merely because it aggregates the series.

## 5. Vintage strategy after source migration

The target architecture remains:

CURRENT PLANE
→ latest authoritative observation used for live analysis.

POINT-IN-TIME PLANE
→ immutable observation versions containing:
- indicator
- observation date
- value
- information/release date where officially available
- retrieval timestamp
- source/version metadata

The exact vintage schema may be retained conceptually, but its source-specific fields must not pretend that every provider exposes FRED-style `realtime_start`/`realtime_end`.

Provider-specific version semantics must be normalized into a common internal concept such as:

- `available_from`
- `available_until`
- `vintage_key`
- `source_version`

where the source actually supports those concepts.

## 6. Historical analysis rules

For a historical analysis date T:

1. Select only data officially available by T.
2. Never fall back to a later revision when the historical source version is unavailable.
3. Keep observation date separate from release/availability date.
4. Keep consensus/forecast timestamp separate from actual data timestamp.
5. Derived indicators must use point-in-time inputs consistently.
6. If exact release time is unavailable, the system must label the analysis as date-level rather than intraday.

## 7. Initial-release vs revised-value semantics

The future system should distinguish:

- **initial release** — first published value available to the analyst;
- **subsequent revision** — later official change to that observation;
- **current value** — latest known revision;
- **point-in-time value** — value available as of a historical date.

These are different analytical objects and must never be silently substituted for one another.

## 8. What NOT to implement now

Do not:

- run a full FRED/ALFRED vintage backfill;
- add a FRED archival cron;
- build a FRED-to-Supabase historical archive;
- use FRED vintage data as training data for the AI layer;
- expand the Step 13G pilot into production storage.

## 9. What to do instead

### Step 13I — Authoritative-source acquisition audit

Before writing more vintage code, map every current indicator to its originating provider and determine:

1. official API/file endpoint;
2. whether historical revisions are exposed;
3. whether vintage/version history is available;
4. whether storage/archival is permitted;
5. attribution requirements;
6. rate limits;
7. release-date/timestamp availability;
8. whether the source can support the exact MUJIFX calculations.

### Step 13J — Source-specific ingestion contracts

Only after 13I should we implement provider-specific ingestion. BLS, BEA, Federal Reserve/Treasury, and CBOE-origin data should not be forced into one provider's semantics.

### Step 13K — Point-in-time database implementation

Build the final versioned observation model only after the permitted source contracts are known.

## 10. Why this is the correct architecture

A fundamental-analysis engine is only as reliable as its data provenance. A technically perfect vintage database built from a source that does not permit archival use is not production-grade.

MUJIFX should prioritize:

**authoritative source → permitted storage → provenance → point-in-time correctness → calculations → assessment → AI explanation → frontend.**

That order is now locked for the project.

## 11. References

- FRED API Terms of Use: https://fred.stlouisfed.org/docs/api/terms_of_use.html
- FRED real-time periods: https://fred.stlouisfed.org/docs/api/fred/realtime_period.html
- FRED vintage dates: https://fred.stlouisfed.org/docs/api/fred/series_vintagedates.html
- BLS API Terms of Service: https://www.bls.gov/developers/termsOfService.htm
- BLS Public Data API: https://www.bls.gov/bls/api_features.htm
- BEA API registration/documentation: https://apps.bea.gov/api/signup/
