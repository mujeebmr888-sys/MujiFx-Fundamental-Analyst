# STEP 13N — P1 AUTHORITATIVE SOURCE CONTRACTS

## Purpose

Define the authoritative-source contracts for the remaining P1 indicators before any scoring or UI changes. This document is a source contract only: it does not change assessment logic.

## P1 scope

| Indicator | Current legacy transport | Target authoritative source | Status |
|---|---|---|---|
| PPI | FRED `PPIACO` | U.S. Bureau of Labor Statistics PPI API | Contract identified |
| INITIAL_JOBLESS_CLAIMS | FRED `ICSA` | U.S. Department of Labor / ETA weekly UI claims publication | Source contract requires endpoint verification |
| CONTINUING_CLAIMS | FRED `CCSA` | U.S. Department of Labor / ETA weekly UI claims publication | Source contract requires endpoint verification |
| JOLTS | FRED `JTSJOL` | U.S. Bureau of Labor Statistics JOLTS API, series `JTS000000000000000JOL` | Contract identified |
| SAHM_RULE | FRED `SAHMREALTIME` | Derived from authoritative BLS unemployment observations | Derivation contract |
| RETAIL_SALES | FRED `RSAFS` | U.S. Census Bureau Economic Indicators Time Series, Monthly Retail Trade / Advance Monthly Sales | API requires Census key; contract identified |
| INDUSTRIAL_PRODUCTION | FRED `INDPRO` | Federal Reserve Board G.17 Industrial Production and Capacity Utilization | Contract identified |

## Source rules

1. P1 ingestion must use first-party government sources where an authoritative public interface exists.
2. FRED must not be used as the permanent archival source for these P1 observations. It may remain as a legacy/reference transport while migration is incomplete.
3. No release dates may be fabricated. If the authoritative adapter does not expose a verified release date, store `sourceReleaseDate = null` and `sourceReleaseDateVerified = false`.
4. Every observation must carry the official source name, source URL, source observation identifier where available, retrieval timestamp, and period covered.
5. The authoritative writer remains the only persistence path for P1 ingestion.
6. No scoring/assessment rule changes are part of Step 13N.

## PPI contract

Source: BLS Public Data API.

Primary series selected for the existing PPI indicator: `PPIACO` is the legacy FRED mapping and must not be copied into the new authoritative contract as a FRED identifier. The BLS adapter should use a directly verified BLS PPI series ID. The BLS PPI documentation confirms that PPI commodity/FD-ID series use `WPU`/`WPS` prefixes and that the Series Report tool is the authoritative lookup path.

The adapter must preserve the published PPI value and period without re-scaling or inventing a release date.

## JOLTS contract

Source: BLS Public Data API.

Series: `JTS000000000000000JOL` — Job openings level, Total nonfarm, seasonally adjusted.

The existing methodology uses JOLTS as a three-release trend input. The authoritative adapter therefore needs at least the latest four valid monthly observations for the assessment read depth.

## SAHM contract

SAHM is not ingested from the FRED-calculated `SAHMREALTIME` series in the authoritative path. It is a derived indicator based on the authoritative BLS unemployment-rate history already stored in `UNEMPLOYMENT_RATE`.

The derivation must remain transparent and deterministic and must not create an independent source observation pretending to be a published BLS series. The current Employment engine treats SAHM as supporting stress evidence rather than an automatic override.

## Retail Sales contract

Source: U.S. Census Bureau Economic Indicators Time Series API.

The Census Economic Indicators API includes the Monthly Retail Trade and Food Services (`mrts`) and Advance Monthly Sales for Retail and Food Services (`marts`) datasets. The Census API now requires an API key. The adapter must use the exact dataset/variable combination selected for the existing `RETAIL_SALES` methodology after verifying the official variable definition. Precision must be preserved as published.

## Industrial Production contract

Source: Federal Reserve Board G.17 Industrial Production and Capacity Utilization release/data files.

The existing indicator represents the industrial production index. The authoritative adapter should use the official G.17 series corresponding to the existing methodology, preserve the published index value, and record the observation month. G.17 provides official data files and release documentation.

## Jobless claims blocker

Initial and continuing jobless claims are weekly Department of Labor / Employment and Training Administration data rather than BLS monthly survey series. Before implementation, the exact first-party machine-readable endpoint and series definition must be verified. Until that verification is complete, do not silently replace the data with a third-party feed or FRED archive.

## Completion rule

Step 13N is complete only when each P1 indicator has either:

- an implemented first-party authoritative adapter and ingestion route, or
- an explicitly documented first-party source blocker that prevents safe implementation without guessing.

No P1 assessment result should be labeled authoritative until its required source contract is satisfied.
