# MUJIFX Step 13H — Production Vintage Ingestion Strategy

Status: DESIGN COMPLETE — implementation follows after this contract.

## 1. Objective

Turn the Step 13G FRED/ALFRED vintage pilot into a production-safe historical and recurring vintage ingestion system without changing the existing fundamental assessment methodology or the current latest-data sync.

The vintage layer exists to prevent look-ahead/revision leakage in historical analysis. The current `economic_data_points` table remains the latest/current operational dataset. `indicator_observation_vintages` is the point-in-time historical layer.

FRED defines a vintage date as a date when a series' values were revised or new values were released, excluding dates on which the series did not change. FRED real-time periods are closed intervals and represent what information was known during that period. Therefore MUJIFX must preserve the FRED-returned real-time boundaries rather than infer them from calendar assumptions.

## 2. Core architectural rule

Maintain two independent data planes:

1. CURRENT PLANE
   - Existing `economic_data_points`.
   - Used by live/latest analysis.
   - Existing `/api/sync/all` remains unchanged.

2. POINT-IN-TIME PLANE
   - `indicator_observation_vintages`.
   - Stores value + observation date + FRED real-time start/end.
   - Used for historical/as-of-date analysis and future unbiased backtests.
   - Never overwrite one vintage with another.

The two planes may coexist indefinitely. Vintage ingestion must not silently replace current data.

## 3. Indicator classification

### MUST have vintage history

| Indicator | FRED series | Priority | Reason |
|---|---|---:|---|
| CPI | CPIAUCSL | P0 | Core inflation input; seasonally adjusted CPI can be revised, including annual seasonal-factor revisions. |
| CORE_CPI | CPILFESL | P0 | Direct inflation assessment input and subject to revisions/seasonal adjustment. |
| PCE | PCEPI | P0 | Fed-relevant inflation input; BEA revises historical PCE data. |
| CORE_PCE | PCEPILFE | P0 | Primary 2% target-distance input; historical revisions matter directly to policy/backtests. |
| PPI | PPIACO | P1 | Inflation pipeline input; historical revisions and series-definition validation matter. |
| NFP | PAYEMS | P0 | Major employment input; establishment-survey employment is revised/benchmarked. |
| UNEMPLOYMENT_RATE | UNRATE | P0 | Employment and Sahm-related input; historical values can be revised. |
| AVG_HOURLY_EARNINGS | CES0500000003 | P0 | Wage-pressure input; historical revisions can affect YoY/trend assessment. |
| INITIAL_JOBLESS_CLAIMS | ICSA | P1 | Weekly labor-market trend; revised observations can affect historical signals. |
| CONTINUING_CLAIMS | CCSA | P1 | Weekly labor-market trend; revised observations can affect historical signals. |
| JOLTS | JTSJOL | P1 | Labor-demand input; historical survey data are revised. |
| SAHM_RULE | SAHMREALTIME | P1 | The FRED series is explicitly the real-time Sahm Rule series; point-in-time employment stress must not use today's revised history. |
| GDP_GROWTH_RATE | A191RL1Q225SBEA | P0 | Major growth input; GDP is heavily revision-prone and is essential for unbiased historical policy assessment. |
| RETAIL_SALES | RSAFS | P1 | Growth input and monthly trend; revisions can change historical growth classification. |
| INDUSTRIAL_PRODUCTION | INDPRO | P1 | Growth input; historical revisions can change trend classification. |
| FED_FUNDS_RATE | FEDFUNDS | P0 | Policy-state history must be point-in-time when reconstructing historical monetary conditions. |

### SHOULD have vintage history

| Indicator | FRED series | Priority | Reason |
|---|---|---:|---|
| TREASURY_2Y | DGS2 | P2 | Important market-pricing confirmation, but for market backtests timestamped market observations are more important than extensive vintage snapshots. |
| TREASURY_10Y | DGS10 | P2 | Same as 2Y; useful for historical curve context, but not as revision-sensitive as macro releases. |
| BROAD_DOLLAR_INDEX | DTWEXBGS | P2 | Useful as historical market confirmation/divergence; long vintage history is lower priority. |
| VIX | VIXCLS | P2 | Useful risk context; market-history accuracy matters more than storing every FRED vintage indefinitely. Pilot already proves the vintage layer works for it. |

### NOT required as a separate vintage priority

None of the current 20 indicators should be deleted from consideration. The four P2 market indicators can be ingested after the macro P0/P1 layer. Their current/latest histories remain fully usable for ordinary charting.

## 4. Vintage depth policy

Do NOT use an arbitrary number of vintages per series. Depth is defined by historical coverage and release/change events.

### Initial production target

- P0 macro indicators: **10 years of vintage coverage, or all available vintages if the series began less than 10 years ago**.
- P1 macro indicators: **7 years of vintage coverage**.
- P2 market indicators: **3 years of vintage coverage initially**.
- SAHM_RULE: **same 7-year window as P1 employment**, because its value is a derived real-time signal and must remain historically point-in-time.

The target is a DATE WINDOW, not a fixed row count. FRED's `vintagedates` endpoint already identifies dates when a series actually changed, so ingestion should select those dates rather than fabricate a regular schedule.

### Why date-window coverage is preferred

A fixed count such as "100 vintages" is not comparable across monthly, weekly, daily, and quarterly series. A 10-year calendar window provides comparable historical coverage while allowing each series to retain its real revision/release frequency.

## 5. What each dataset means

### Current/latest

The value currently available from FRED. This is appropriate for live analysis but can contain later revisions to historical observations.

### Historical vintage

A value as it existed in a particular FRED real-time period. This is the primary dataset for reconstructing what an analyst could have known at the time.

### Initial release

The first FRED vintage in which an observation became available. This is useful for measuring first-release surprises and revision magnitude, but it is NOT automatically the correct dataset for every historical backtest.

### Point-in-time / as-of-date

For an analysis date T, select the latest vintage whose real-time period contains T. This is the canonical dataset for historical fundamental reconstruction.

## 6. Correct dataset by use case

| Use case | Dataset |
|---|---|
| Current live fundamental analysis | Current/latest plane |
| Historical fundamental report | Point-in-time/as-of-date vintage |
| Unbiased historical backtest | Point-in-time/as-of-date vintage |
| First-release surprise study | Initial-release vintage |
| Revision analysis | Compare initial release vs later/current vintages |
| Current charting | Current/latest plane |

Never use today's revised observation to simulate what was known on a historical date.

## 7. Production ingestion algorithm

### One-time historical backfill

For each enabled indicator:

1. Determine the indicator's configured historical coverage start date.
2. Call FRED `series/vintagedates` for the series.
3. Keep vintage dates inside the configured coverage window.
4. Fetch each selected vintage individually using a point-in-time real-time window (`realtime_start = T`, `realtime_end = T`).
5. Preserve FRED's returned `realtime_start` and `realtime_end` exactly.
6. Normalize each observation:
   - numeric value → `is_missing=false`, value numeric
   - `.` → `is_missing=true`, value NULL
7. Save through the existing atomic writer.
8. Use `(indicator, observation_date, realtime_start)` as the natural idempotency key.
9. If a vintage fetch fails, record the error and continue with the next vintage; never substitute current data.
10. Produce an ingestion report containing attempted, fetched, saved, skipped, missing, and failed counts.

### Recurring vintage update

Do not repeatedly download the entire historical window.

On each scheduled update:

1. Discover FRED vintage dates for each enabled indicator.
2. Compare discovered dates with the latest stored `realtime_start` / stored coverage.
3. Fetch only new or not-yet-verified vintage dates, plus a small configurable overlap window for safety.
4. Save idempotently.
5. Leave the existing latest-data `/api/sync/all` path untouched.

The overlap exists because a retry/redeployment can occur around a release boundary; idempotent storage makes re-fetching safe.

## 8. Why we use FRED vintage dates rather than a guessed release calendar

FRED's `series/vintagedates` returns dates when the series actually changed. Release calendars are broader publication events and do not establish that a particular series' observation changed on every release date.

Therefore:

- series vintagedates = source of truth for vintage ingestion
- release calendar = future enhancement for official release metadata/timestamps

Do not infer `release_date` from `observation_date`.

## 9. Look-ahead and revision safeguards

The vintage layer must enforce these rules:

1. Historical calculations may only read vintages available by the analysis/as-of date.
2. Never fall back from a missing historical vintage to the current value.
3. Never calculate a historical surprise using today's consensus/current value.
4. Never use an observation whose `realtime_start` is after the historical analysis date.
5. Never assume `observation_date` equals release date.
6. Never overwrite an older vintage with a revised value.
7. Preserve the open-ended latest vintage with `realtime_end = NULL` only when that is the stored current open vintage.
8. Preserve FRED-returned real-time boundaries; do not manufacture end dates from the next discovered vintage in application code.
9. Derived indicators must be calculated from the same point-in-time vintage family as their inputs.
10. Daily market data and macro release data must not be conflated: market timestamp/history is a separate concern from macro-data revision history.

## 10. Important limitation: date-level, not intraday

FRED/ALFRED real-time periods are date-based. This vintage layer can reconstruct information known during a calendar date, but it does not by itself establish the exact release timestamp or the exact minute a market could have reacted.

Therefore a future intraday event/backtest engine must add official release timestamps and timezone handling separately. Do not pretend the vintage table provides intraday release timing.

## 11. Initial release handling

Do not create a second table for initial releases.

Initial release is represented by the earliest available vintage for an observation. A future helper/query can select the earliest `realtime_start` for each `(indicator, observation_date)`.

This keeps one authoritative vintage table and avoids duplicate storage models.

## 12. Atomic writer contract

The existing writer remains the only production write path for the vintage table.

Required properties:

- close the currently open vintage for the same indicator + observation date when a newer vintage supersedes it;
- insert the new vintage atomically;
- preserve old rows;
- enforce unique `(indicator, observation_date, realtime_start)`;
- preserve NULL/open semantics for the latest vintage;
- remain safe under retry;
- avoid partial close-without-insert states.

## 13. Rollout phases

### Phase 1 — P0 macro core

CPI, CORE_CPI, PCE, CORE_PCE, NFP, UNEMPLOYMENT_RATE, AVG_HOURLY_EARNINGS, GDP_GROWTH_RATE, FED_FUNDS_RATE.

Target: 10 years where available.

### Phase 2 — P1 macro expansion

PPI, INITIAL_JOBLESS_CLAIMS, CONTINUING_CLAIMS, JOLTS, SAHM_RULE, RETAIL_SALES, INDUSTRIAL_PRODUCTION.

Target: 7 years.

### Phase 3 — P2 market context

TREASURY_2Y, TREASURY_10Y, BROAD_DOLLAR_INDEX, VIX.

Target: 3 years initially.

The existing Step 13G VIX/GDP pilot rows remain valid and must be reused rather than duplicated.

## 14. Pre-backfill validation checklist

Before Phase 1 is allowed to run:

- [x] `indicator_observation_vintages` exists.
- [x] strict value/missing constraint exists.
- [x] natural key exists.
- [x] one-open-vintage partial unique index exists.
- [x] atomic writer exists and has been executed in Supabase.
- [x] GDP + VIX pilot successfully discovered, fetched, and stored multiple vintages.
- [x] old vintages close and latest vintage remains open.
- [ ] production ingestion route has date-window configuration.
- [ ] production route has bounded execution / batching appropriate for Vercel.
- [ ] production route has resumability/idempotency reporting.
- [ ] as-of-date read helper exists and is tested against pilot rows.
- [ ] no assessment engine reads the vintage table yet.
- [ ] full backfill is isolated from `/api/sync/all`.
- [ ] PPI series mapping has been separately validated against the intended PPI concept before it is used as a high-confidence inflation input.

## 15. Required next implementation

Step 13I should implement the production vintage ingestion infrastructure only:

1. shared vintage coverage configuration;
2. reusable production vintage fetcher;
3. batched/resumable backfill route;
4. recurring incremental vintage update route/function;
5. point-in-time query helper;
6. ingestion result/audit reporting;
7. no changes to assessment calculations;
8. no full backfill automatically triggered by deployment.

Only after Step 13I is tested should the actual Phase 1 backfill be run.

## 16. Official references

- FRED `series/vintagedates`: https://fred.stlouisfed.org/docs/api/fred/series_vintagedates.html
- FRED `series/observations`: https://fred.stlouisfed.org/docs/api/fred/series_observations.html
- FRED real-time periods: https://fred.stlouisfed.org/docs/api/fred/realtime_period.html
- FRED release dates: https://fred.stlouisfed.org/docs/api/fred/releases_dates.html
- BLS CPI seasonal adjustment/revisions: https://www.bls.gov/cpi/seasonal-adjustment/
- BLS revisions overview: https://www.bls.gov/about-bls/revisions.htm
