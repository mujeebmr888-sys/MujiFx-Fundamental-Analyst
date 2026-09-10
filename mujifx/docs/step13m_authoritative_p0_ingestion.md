# Step 13M — Authoritative P0 ingestion

## Purpose

Move the approved P0 macro indicators from their original official providers into the shared MUJIFX authoritative writer without changing the deterministic assessment methodology.

## P0 coverage

| Category | Indicator | Official source | Route |
|---|---|---|---|
| Inflation | CPI | BLS CPI API | `/api/sync/authoritative-cpi` |
| Inflation | Core CPI | BLS CPI API | `/api/sync/authoritative-cpi` |
| Inflation | PCE | BEA NIPA T20807 | `/api/sync/authoritative-pce` |
| Inflation | Core PCE | BEA NIPA T20807 | `/api/sync/authoritative-pce` |
| Employment | NFP | BLS CES | `/api/sync/authoritative-employment` |
| Employment | Unemployment rate | BLS CPS | `/api/sync/authoritative-employment` |
| Employment | Average hourly earnings | BLS CES | `/api/sync/authoritative-employment` |
| Growth | GDP growth rate | BEA NIPA T10101 | `/api/sync/authoritative-gdp` |
| Monetary Policy | Effective federal funds rate | Federal Reserve H.15 | `/api/sync/authoritative-fed-funds` |

A consolidated manual entry point is also provided at `/api/sync/authoritative-p0`.

## Provenance rules

- Source tier is `TIER_1_OFFICIAL`.
- BLS/BEA/Federal Reserve observations retain a provider-specific observation ID.
- `source_release_date` remains null and `source_release_date_verified` remains false unless the source contract explicitly establishes the release date.
- The legacy required `release_date` field is only a compatibility field; it must not be interpreted as a verified publication date.
- No consensus forecast is invented during authoritative ingestion.
- No assessment or score is calculated by the ingestion route.

## Period normalization

- BLS monthly periods are normalized to `YYYY-MM`.
- BEA monthly periods (`YYYYMmm`) are normalized to `YYYY-MM`.
- BEA quarterly periods (`YYYYQn`) are normalized to the quarter-start month (`YYYY-01`, `YYYY-04`, `YYYY-07`, `YYYY-10`) so existing period ordering remains chronological.
- BEA GDP growth is stored exactly as BEA publishes it at a seasonally adjusted annual rate; it is not re-annualized.

## Boundary

This step completes the P0 source-to-database ingestion path. It does **not** yet make the existing assessment engine prefer authoritative rows over legacy FRED rows, and it does not remove the legacy FRED transport.

The next engineering step is to make the analysis layer explicitly select authoritative data where available, preserve source provenance in the returned assessment, and expose the deterministic category outputs through a server-side analysis API before the frontend is connected to them.
