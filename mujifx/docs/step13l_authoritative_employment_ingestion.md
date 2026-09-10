# Step 13L — Authoritative Employment Ingestion

## Status
Implemented in isolation.

## Scope
This step adds a server-side ingestion route for three P0 Employment indicators from the U.S. Bureau of Labor Statistics (BLS):

- NFP — `CES0000000001`
- Unemployment Rate — `LNS14000000`
- Average Hourly Earnings — `CES0500000003`

The existing BLS source adapter remains read-only. The new route converts observations into the shared authoritative observation contract and writes them through the shared authoritative writer.

## Data integrity rules

- Observation periods are preserved as `YYYY-MM`.
- Previous values are calculated only from the immediately older observation returned by BLS for the same series.
- No consensus forecast is fabricated.
- No release date is fabricated from the observation period.
- Source observation IDs are retained.
- Writes are tagged as `authoritative_bls` by the shared writer.
- Ingestion results are recorded in `authoritative_ingestion_runs`.

## Scope boundary

This route does not replace the legacy FRED employment route, alter Employment scoring, alter the assessment orchestrator, or change the frontend.

## Next verification

The route must be deployed and invoked in the live Vercel environment. Supabase must then be checked for authoritative BLS rows and successful ingestion-audit records before this source is treated as production-verified.
