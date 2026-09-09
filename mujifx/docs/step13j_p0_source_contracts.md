# MUJIFX Step 13J — P0 Authoritative Source Contracts

Status: IMPLEMENTATION — P0 source contracts documented; BLS CPI pilot adapter added in isolation.

## Scope

Step 13J defines the authoritative originating source for the nine P0 indicators before production ingestion is migrated away from the current FRED transport layer.

No assessment methodology, scoring rule, or existing FRED sync behavior is changed by this step.

## Source contract table

| MUJIFX ID | Authoritative publisher | Official identifier / concept | Frequency | Unit | Release metadata | Revision / as-of capability | Production note |
|---|---|---|---|---|---|---|---|
| `CPI` | U.S. Bureau of Labor Statistics (BLS) | CPI-U U.S. city average, All items, Seasonally Adjusted — BLS `CUSR0000SA0` | Monthly | Index, 1982-84=100 | BLS CPI release/publication calendar; API observation payload itself does not provide a release timestamp | BLS publishes revised/updated historical observations; point-in-time archival requires release/vintage metadata captured from the publisher/release | P0 pilot. Do not map release date to observation date. |
| `CORE_CPI` | BLS | CPI-U U.S. city average, All items less food and energy, Seasonally Adjusted — BLS `CUSR0000SA0L1E` | Monthly | Index, 1982-84=100 | BLS CPI release/publication calendar | Historical observations can change; release-aware storage must retain retrieval/release context | Exact BLS series selected to match the existing MUJIFX core-CPI concept. |
| `PCE` | U.S. Bureau of Economic Analysis (BEA) | Personal Consumption Expenditures Price Index — BEA NIPA price-index concept corresponding to FRED `PCEPI` | Monthly | Index, 2017=100 | BEA Personal Income and Outlays release | BEA historical NIPA estimates are revised; production must capture publication/release context rather than infer it from observation date | Direct BEA table/line identifier remains a validation item before adapter implementation. |
| `CORE_PCE` | BEA | PCE Price Index excluding food and energy — BEA NIPA concept corresponding to FRED `PCEPILFE`; BEA account code `DPCCRG` is documented for the series | Monthly | Index, 2017=100 | BEA Personal Income and Outlays release | BEA historical NIPA estimates are revised; production must capture publication/release context | Direct BEA table/line identifier remains a validation item before adapter implementation. |
| `NFP` | BLS Current Employment Statistics (CES) | All Employees, Total Nonfarm — CES `CES0000000001`; SA | Monthly | Thousands of persons | Employment Situation release | Preliminary and revised estimates; benchmark revisions and historical revisions matter | Production adapter must preserve release/revision context. |
| `UNEMPLOYMENT_RATE` | BLS Current Population Survey (CPS) | Civilian unemployment rate, age 16+, SA — BLS `LNS14000000` | Monthly | Percent | Employment Situation release | Historical CPS estimates can be revised; release-aware storage required | Exact series should be verified against BLS CPS metadata during adapter implementation. |
| `AVG_HOURLY_EARNINGS` | BLS CES | Average Hourly Earnings of All Employees, Total Private — CES `CES0500000003`; SA | Monthly | Dollars per hour | Employment Situation release | Preliminary/revised historical observations and annual benchmark/reclassification effects must be preserved where applicable | Exact intended wage coverage is total private, all employees. |
| `GDP_GROWTH_RATE` | BEA NIPA | Real GDP percent change, seasonally adjusted annual rate — current FRED transport `A191RL1Q225SBEA` | Quarterly | Percent change at seasonally adjusted annual rate | BEA GDP release / annual and comprehensive revisions | BEA publishes revised historical GDP vintages; point-in-time use requires release context | Direct BEA table/line identifier remains a validation item before adapter implementation. Never re-annualize the published growth rate. |
| `FED_FUNDS_RATE` | Board of Governors of the Federal Reserve System | Effective Federal Funds Rate — H.15 `RIFSPFF_N.M` monthly average; daily H.15 series also exists | Daily / monthly | Percent per year | H.15 release/data publication | Historical published rates are authoritative observations; policy target range is a separate concept | MUJIFX current indicator is the effective rate, not the FOMC target range. Production adapter should choose frequency explicitly. |

## CPI pilot contract

### Publisher

U.S. Bureau of Labor Statistics, Consumer Price Index program.

### Series

`CUSR0000SA0` — CPI-U U.S. city average, All items, Seasonally Adjusted.

BLS documents the CPI series-code structure and identifies `S` as seasonally adjusted and `SA0` as the all-items aggregate for the U.S. city average. The MUJIFX CPI calculation uses the seasonally adjusted index because the assessment relies on short-term month-over-month inflation momentum.

### Retrieval

BLS Public Data API v2 endpoint:

`https://api.bls.gov/publicAPI/v2/timeseries/data/`

The pilot requests the series by ID and a bounded historical year range. No FRED call is made by the pilot.

### Normalization

BLS API observations provide:

- `year`
- `period` (`M01` … `M12` for monthly observations)
- `periodName`
- `value`
- optional footnotes

MUJIFX normalizes the observation period to `YYYY-MM`.

### Release-date rule

The BLS API observation payload does not itself provide an official release timestamp. Therefore the CPI pilot MUST NOT set `releaseDate = periodCovered` and MUST NOT pretend the observation date is the publication date.

The current `EconomicDataPoint.releaseDate` field is therefore intentionally not used for a production write by this pilot. A later approved release-metadata migration must supply the official CPI publication date/time from BLS release metadata.

### Revision rule

A later retrieval of the same observation period may contain a revised value. The production revision layer must treat the publisher's release/publication context as the version key rather than overwriting a historical value solely because the observation period is identical.

### Storage rule

The CPI pilot is read-only. It does not write to `economic_data_points`, the vintage table, or any existing production table.

## P0 implementation order

1. CPI — BLS pilot (this step)
2. Core CPI — BLS
3. NFP — BLS CES
4. Unemployment — BLS CPS
5. Average Hourly Earnings — BLS CES
6. PCE — BEA
7. Core PCE — BEA
8. GDP Growth — BEA
9. Federal Funds Rate — Federal Reserve Board

Each adapter must be independently validated before the next one is connected to production storage.

## Explicit non-goals

- No FRED mapping removal in Step 13J.
- No historical backfill expansion.
- No vintage archive expansion from FRED/ALFRED.
- No scoring or assessment-rule changes.
- No frontend work.

## Source references

- BLS CPI series ID documentation: https://www.bls.gov/cpi/factsheets/cpi-series-ids.htm
- BLS Public Data API: https://www.bls.gov/developers/api_python.htm
- Federal Reserve H.15: https://www.federalreserve.gov/datadownload/Choose.aspx?rel=H15
- Existing MUJIFX authoritative-source audit: `docs/step13i_authoritative_source_audit.md`
