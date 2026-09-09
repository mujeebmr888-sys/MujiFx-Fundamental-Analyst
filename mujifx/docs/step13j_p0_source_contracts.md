# MUJIFX Step 13J — P0 Authoritative Source Contracts

Status: IMPLEMENTATION — all nine P0 source contracts documented; isolated authoritative-source pilots added for BLS CPI/Core CPI/employment, BEA PCE/Core PCE/GDP growth, and Federal Reserve effective federal funds rate.

## Scope

Step 13J defines the authoritative originating source for the nine P0 indicators before production ingestion is migrated away from the current FRED transport layer.

No assessment methodology, scoring rule, or existing FRED sync behavior is changed by this step.

## Source contract table

| MUJIFX ID | Authoritative publisher | Official identifier / concept | Frequency | Unit | Release metadata | Revision / as-of capability | Production note |
|---|---|---|---|---|---|---|---|
| `CPI` | U.S. Bureau of Labor Statistics (BLS) | CPI-U U.S. city average, All items, Seasonally Adjusted — BLS `CUSR0000SA0` | Monthly | Index, 1982-84=100 | BLS CPI release/publication calendar; API observation payload itself does not provide a release timestamp | BLS publishes revised/updated historical observations; point-in-time archival requires release/vintage metadata captured from the publisher/release | P0 pilot. Do not map release date to observation date. |
| `CORE_CPI` | BLS | CPI-U U.S. city average, All items less food and energy, Seasonally Adjusted — BLS `CUSR0000SA0L1E` | Monthly | Index, 1982-84=100 | BLS CPI release/publication calendar | Historical observations can change; release-aware storage must retain release/retrieval context | Exact BLS series selected to match the existing MUJIFX core-CPI concept. |
| `PCE` | U.S. Bureau of Economic Analysis (BEA) | Personal Consumption Expenditures Price Index — BEA NIPA price-index concept corresponding to FRED `PCEPI` | Monthly | Index, 2017=100 | BEA Personal Income and Outlays release | BEA historical NIPA estimates are revised; production must capture publication/release context rather than infer it from observation date | Direct BEA table/line implemented in isolated pilot. |
| `CORE_PCE` | BEA | PCE Price Index excluding food and energy — BEA NIPA concept corresponding to FRED `PCEPILFE`; BEA account code `DPCCRG` is documented for the series | Monthly | Index, 2017=100 | BEA Personal Income and Outlays release | BEA historical NIPA estimates are revised; production must capture publication/release context | Direct BEA table/line implemented in isolated pilot. |
| `NFP` | BLS Current Employment Statistics (CES) | All Employees, Total Nonfarm — CES `CES0000000001`; SA | Monthly | Thousands of persons | Employment Situation release | Preliminary and revised estimates; benchmark revisions and historical revisions matter | Production adapter must preserve release/revision context. |
| `UNEMPLOYMENT_RATE` | BLS Current Population Survey (CPS) | Civilian unemployment rate, age 16+, SA — BLS `LNS14000000` | Monthly | Percent | Employment Situation release | Historical CPS estimates can be revised; release-aware storage required | Exact series verified for the pilot. |
| `AVG_HOURLY_EARNINGS` | BLS CES | Average Hourly Earnings of All Employees, Total Private — CES `CES0500000003`; SA | Monthly | Dollars per hour | Employment Situation release | Preliminary/revised historical observations and annual benchmark/reclassification effects must be preserved where applicable | Exact intended wage coverage is total private, all employees. |
| `GDP_GROWTH_RATE` | BEA NIPA | Real GDP percent change, seasonally adjusted annual rate — BEA NIPA Table `T10101`, line `1` | Quarterly | Percent change at seasonally adjusted annual rate | BEA GDP release / annual and comprehensive revisions | BEA publishes revised historical GDP vintages; point-in-time use requires release context | Pilot uses BEA published rate as-is. Never re-annualize. |
| `FED_FUNDS_RATE` | Board of Governors of the Federal Reserve System | Effective Federal Funds Rate — H.15 `RIFSPFF_N.M` monthly average; daily H.15 series also exists | Daily / monthly | Percent per year | H.15 release/data publication | Historical published rates are authoritative observations; policy target range is a separate concept | Pilot explicitly uses the monthly effective rate, not the FOMC target range. |

## CPI pilot contract

### Publisher

U.S. Bureau of Labor Statistics, Consumer Price Index program.

### Series

`CUSR0000SA0` — CPI-U U.S. city average, All items, Seasonally Adjusted.

### Retrieval

BLS Public Data API v2 endpoint:

`https://api.bls.gov/publicAPI/v2/timeseries/data/`

The pilot requests the series by ID and a bounded historical year range. No FRED call is made by the pilot.

### Release-date rule

The BLS API observation payload does not itself provide an official release timestamp. Therefore the CPI pilot MUST NOT set `releaseDate = periodCovered`.

### Storage rule

The CPI pilot is read-only. It does not write to `economic_data_points`, the vintage table, or any existing production table.

## GDP Growth pilot contract

### Publisher

U.S. Bureau of Economic Analysis, National Income and Product Accounts.

### Source

NIPA Table `T10101` — Table 1.1.1, Percent Change From Preceding Period in Real GDP; line `1` is Gross domestic product.

### Retrieval

BEA Data API with the server-side Vercel environment variable `BEA` as the UserID/API key. The pilot requests quarterly data directly from BEA.

### Calculation rule

BEA publishes the quarterly real-GDP percent change at a seasonally adjusted annual rate. MUJIFX stores that published value as-is and does not re-annualize it.

### Storage rule

The GDP pilot is read-only and does not write to production storage.

## Federal Funds pilot contract

### Publisher

Board of Governors of the Federal Reserve System, H.15 Selected Interest Rates.

### Series

`RIFSPFF_N.M` — Federal funds effective rate, monthly average, percent per year.

The Federal Reserve confirms the series is the effective federal funds rate and provides monthly observations in the H.15 Data Download Program. The current official H.15 data show 3.63% for July 2026 and 3.63% for June 2026. citeturn0search0

### Retrieval

The isolated pilot uses the official H.15 Data Download Program Preview endpoint for `RIFSPFF_N.M`. No API key is required. The Fed also provides H.15 downloadable packages and XML/SDMX data. citeturn1search0turn2search12

### Frequency choice

MUJIFX's current methodology treats the effective federal funds rate as the monetary-policy level input. Therefore this P0 pilot uses the monthly H.15 series rather than the daily effective rate. The FOMC target range remains a distinct concept and is not substituted into this indicator.

### Storage rule

The Federal Reserve pilot is read-only. It does not write to `economic_data_points`, the vintage table, or any existing production table.

## P0 implementation order

1. CPI — BLS pilot
2. Core CPI — BLS
3. NFP — BLS CES
4. Unemployment — BLS CPS
5. Average Hourly Earnings — BLS CES
6. PCE — BEA
7. Core PCE — BEA
8. GDP Growth — BEA pilot
9. Federal Funds Rate — Federal Reserve H.15 pilot

Each adapter must be independently validated before it is connected to production storage.

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
- Federal Reserve H.15 preview for `RIFSPFF_N.M`: https://www.federalreserve.gov/datadownload/Preview.aspx?pi=400&preview=H15%2FH15%2FRIFSPFF_N.M&rel=H15
- Existing MUJIFX authoritative-source audit: `docs/step13i_authoritative_source_audit.md`
