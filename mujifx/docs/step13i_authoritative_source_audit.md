# MUJIFX Step 13I — Authoritative Source Audit

Status: DESIGN / SOURCE AUDIT COMPLETE — no production ingestion code changed.

## 1. Objective

Define the authoritative-origin source for each current MUJIFX indicator before implementing any production historical/revision ingestion.

The project must distinguish:

- source used for convenient current retrieval;
- authoritative originating publisher;
- whether the source exposes historical revisions/vintages;
- whether the source is suitable for persistent application storage;
- whether release timestamps are available separately from observation dates.

FRED remains a useful current-data transport/reference layer, but MUJIFX must not assume that FRED/ALFRED is automatically the correct archival source for every underlying series.

## 2. Source-policy conclusion

### FRED

FRED API terms state that series available through FRED may be owned by third parties and that the user is responsible for complying with the series owner's requirements. The terms also require the FRED notice for applications using the API and prohibit applications that replicate the essential FRED/ALFRED user experience.

Therefore MUJIFX should not build its permanent historical archive around FRED/ALFRED unless the applicable source rights have been verified for the specific series and intended use.

FRED can remain in the current operational retrieval layer while the originating-source strategy is implemented.

### BLS

BLS provides a public API for historical labor and price series. BLS terms explicitly address secondary use and state that data owners/authoritative sources retain version control. BLS also documents that many programs revise preliminary estimates after initial publication.

BLS is therefore the preferred originating source for the BLS-owned indicators in MUJIFX.

### BEA

BEA provides an official API for published economic statistics, including NIPA datasets. BEA is the preferred originating source for PCE/PCE price-index and GDP-family statistics where the required series is available directly from BEA.

### Federal Reserve Board

For Treasury yields and Federal Reserve dollar-index data, the originating Federal Reserve Board publications/data-download systems are preferred over using FRED as the archival origin. The Fed H.15 system publishes Treasury constant-maturity yields and provides downloadable data. The Fed H.10 system publishes the broad foreign-exchange-value indexes and their methodology/weights.

### Cboe

For VIX, Cboe is the originating index publisher. Cboe provides historical VIX closing data from 1990 to present and describes VIX as its volatility index. Cboe should therefore be treated as the source of record for the VIX market series rather than FRED.

## 3. Indicator source map

| MUJIFX indicator | Current FRED mapping | Authoritative origin to target | Vintage/revision priority | Notes |
|---|---|---|---|---|
| CPI | CPIAUCSL | BLS CPI | P0 | Use BLS series definition directly; preserve revision/seasonal-adjustment metadata where available. |
| CORE_CPI | CPILFESL | BLS CPI | P0 | BLS core CPI concept; verify exact BLS series before implementation. |
| PCE | PCEPI | BEA NIPA / price indexes | P0 | Current FRED mapping was corrected from PCE to PCEPI; target direct BEA concept. |
| CORE_PCE | PCEPILFE | BEA NIPA / price indexes | P0 | Verify exact BEA series/table and whether historical revisions can be retrieved as-of date. |
| PPI | PPIACO | BLS PPI | P1 | MUST validate concept before implementation. PPIACO is not automatically equivalent to Final Demand PPI. |
| NFP | PAYEMS | BLS CES | P0 | Establishment survey series; preliminary/revised/benchmark history matters. |
| UNEMPLOYMENT_RATE | UNRATE | BLS CPS | P0 | Verify BLS series and historical revision behavior. |
| AVG_HOURLY_EARNINGS | CES0500000003 | BLS CES | P0 | Verify exact industry/worker coverage against intended wage concept. |
| INITIAL_JOBLESS_CLAIMS | ICSA | U.S. Department of Labor / ETA | P1 | Current FRED series is a convenient transport; originating program must be verified before archival implementation. |
| CONTINUING_CLAIMS | CCSA | U.S. Department of Labor / ETA | P1 | Same source-of-record principle as initial claims. |
| JOLTS | JTSJOL | BLS JOLTS | P1 | Verify exact total/openings concept and revision behavior. |
| SAHM_RULE | SAHMREALTIME | Derived indicator | P1 | Prefer storing source inputs and a documented derived calculation rather than treating FRED's precomputed series as the only authoritative source. Point-in-time construction must be designed carefully. |
| GDP | GDP | BEA NIPA | P0 if retained | Current assessment does not depend on GDP level directly, but BEA is source of record. |
| GDP_GROWTH_RATE | A191RL1Q225SBEA | BEA NIPA | P0 | Current FRED series is BEA-derived growth rate; direct BEA table/line should be identified and used for production. |
| RETAIL_SALES | RSAFS | U.S. Census Bureau | P1 | Current FRED transport should be replaced/augmented by Census-origin data for archival use. |
| INDUSTRIAL_PRODUCTION | INDPRO | Federal Reserve Board | P1 | Fed Industrial Production and Capacity Utilization source. Verify direct download/API path. |
| FED_FUNDS_RATE | FEDFUNDS | Federal Reserve Board | P0 | Fed is source of record. Distinguish effective rate history from policy target range. |
| TREASURY_2Y | DGS2 | Federal Reserve Board H.15 | P2 | H.15 publishes Treasury constant-maturity 2-year yield. |
| TREASURY_10Y | DGS10 | Federal Reserve Board H.15 | P2 | H.15 publishes Treasury constant-maturity 10-year yield. |
| BROAD_DOLLAR_INDEX | DTWEXBGS | Federal Reserve Board H.10 | P2 | Use Fed's broad index directly; do not confuse with ICE DXY. |
| VIX | VIXCLS | Cboe | P2 | Cboe is source of record; historical daily closing data available. |

## 4. Production priority

### P0 — must be authoritative-source ready before vintage-aware assessment

- CPI
- CORE_CPI
- PCE
- CORE_PCE
- NFP
- UNEMPLOYMENT_RATE
- AVG_HOURLY_EARNINGS
- GDP_GROWTH_RATE
- FED_FUNDS_RATE

### P1 — second wave

- PPI
- INITIAL_JOBLESS_CLAIMS
- CONTINUING_CLAIMS
- JOLTS
- SAHM_RULE
- RETAIL_SALES
- INDUSTRIAL_PRODUCTION

### P2 — market context

- TREASURY_2Y
- TREASURY_10Y
- BROAD_DOLLAR_INDEX
- VIX

## 5. Important methodological rule

Do not equate "revision-aware" with "vintage table exists".

For every indicator, the source must first answer:

1. What exactly is the published concept?
2. What is its observation frequency?
3. What is its official release/publication date?
4. Can the publisher expose historical versions or preliminary/revised values?
5. Can MUJIFX retrieve those versions without relying on a secondary archive?
6. What metadata identifies the version?
7. Is there an official release timestamp, or only a publication date?
8. Are there benchmark/seasonal/reclassification revisions that require special handling?

Only then should the source be connected to the vintage schema.

## 6. Release date vs observation date

The current `economic_data_points` contract uses `releaseDate`, but the FRED implementation currently sets it equal to the observation date. That is semantically incorrect for release-aware analysis.

Production architecture must eventually separate:

- observation_date — period/date the measurement refers to;
- release_date — official publication/release date;
- release_timestamp — exact publication time where the publisher provides it;
- realtime/vintage validity — when the published value was known/current;
- retrieved_at — when MUJIFX fetched the source.

Do not silently reinterpret the existing field until an approved migration is designed.

## 7. PPI warning

The current mapping `PPIACO` must not be treated as generic "PPI" without a concept check. Production implementation must identify the exact BLS PPI series corresponding to the intended inflation assessment concept and document why it is the correct series.

This is a blocking validation before PPI receives high-confidence weight in the production assessment.

## 8. Market-data rule

Market series are different from macro releases.

For Treasury yields and VIX, the primary historical problem is timestamp/session accuracy rather than macro-style revision vintages. The production model should preserve observation date/time and source publication/session conventions rather than forcing all market data into the same vintage workflow.

## 9. Step 13I implementation gate

Before production code is written, the following must be resolved for P0:

- exact originating series/table identifiers;
- official access method/API/file;
- revision/as-of capability;
- release-date/timestamp capability;
- storage/redistribution terms;
- normalization contract;
- mapping from source data into MUJIFX indicator IDs.

Only after those checks should the production ingestion layer be implemented.

## 10. Official sources consulted

- BLS API Terms of Service: https://www.bls.gov/developers/termsOfService.htm
- BLS Data API: https://www.bls.gov/bls/api_features.htm
- BLS Revisions: https://www.bls.gov/about-bls/revisions.htm
- BEA Data API: https://apps.bea.gov/api/signup/
- Federal Reserve H.15 Data Download Program: https://www.federalreserve.gov/datadownload/Choose.aspx?rel=H15
- Federal Reserve H.10 Currency Weights / broad dollar index: https://www.federalreserve.gov/releases/H10/weights/default.htm
- Cboe VIX historical data: https://www.cboe.com/tradable-products/vix/vix-historical-data
- FRED API Terms of Use: https://fred.stlouisfed.org/docs/api/terms_of_use.html

## 11. Exact next step

Step 13J: build the P0 source contracts only — no full ingestion and no assessment changes.

For each P0 indicator, document exact official series/table identifier, frequency, units, release metadata, revision/as-of capability, and permitted retrieval/storage approach. Then implement one small source adapter at a time, starting with BLS CPI as the pilot.
