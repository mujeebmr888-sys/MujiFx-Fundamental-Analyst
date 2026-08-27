# MUJIFX Fundamental Analyst — USD Module

An institutional-style **fundamental research** application (NOT a signal generator).
It analyzes US macroeconomic data the way an experienced macro/fundamental analyst
would: it reads data, compares it to expectations, checks the Fed's stance, confirms
with market pricing (yields, DXY), and produces a written assessment — never a
"buy/sell" call.

## Core principle

This app never outputs trade signals, guaranteed predictions, or fabricated numbers.
Every claim must be traceable to a real source, or explicitly marked
`"Data unavailable / source not verified."`

## Architecture (8 separated layers)

Data flows through these layers in order. Each layer only talks to the layer next
to it — this keeps the system honest and debuggable.

```
1. data-acquisition       → pulls raw data from FRED, BLS, BEA, Treasury.gov
2. data-normalization      → converts raw API responses into one common shape
3. historical-database     → stores normalized data in Firestore over time
4. economic-calculations   → derives things like surprise = actual - forecast
5. forecast-engine         → MUJIFX's own model estimate + confidence + range
6. fundamental-scoring     → turns indicators into a weighted bias score
7. ai-analyst-reasoning    → turns the score + data into written analyst commentary
8. frontend dashboard      → displays everything (Next.js app)
```

See `docs/ARCHITECTURE.md` for details on each layer and `docs/DATA_SOURCES.md`
for exactly which free APIs feed which economic indicator.

## Status: Milestone 2 done — first real end-to-end pipeline

- Full folder/module structure for all 8 layers
- TypeScript types (data contracts) that every layer uses
- Layer 1: real FRED API client
- Layer 2: normalization (FRED shape → database row shape)
- Layer 3: Supabase (Postgres) historical database, with schema in `docs/schema.sql`
- One working end-to-end route: `/api/sync/cpi` pulls real CPI data from FRED
  and saves it to Supabase
- Dashboard homepage reads the latest CPI value from the real database (shows
  "no data yet" honestly if the pipeline hasn't been run — never a fake number)

Nothing is hardcoded or faked. Layers that aren't built yet simply don't exist yet
rather than containing placeholder numbers.

## Tech stack

- Next.js 14 (App Router) + TypeScript — frontend + API routes
- Tailwind CSS — styling (institutional/research look, not flashy)
- Supabase (Postgres) — historical data storage
- FRED API (St. Louis Fed) — primary free data source for CPI, PCE, NFP, GDP, Fed
  funds rate, unemployment, and more
- Treasury.gov — yield curve data (not wired up yet)

## Setup after downloading/updating this project

1. Run `docs/schema.sql` in Supabase → SQL Editor to create the table.
2. Copy `.env.example` to `.env.local` and fill in:
   - `FRED_API_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Run `npm install` then `npm run dev`.
4. Visit `http://localhost:3000/api/sync/cpi` once to pull real CPI data in.
5. Visit `http://localhost:3000` to see it on the dashboard.

## Status: Milestone 7 — real Forecast Engine (Layer 5)

- Removed the manual forecast-entry admin panel — replaced with a real
  Forecast Engine that generates MUJIFX's own estimate from stored trend
  data, per the original spec's "Market expectations" / "Forecast engine"
  requirements
- For CPI, PPI, NFP, and GDP, the engine projects the next release using
  the average recent month-over-month change, with a range and a capped
  "Low"/"Medium" confidence — it never claims certainty, and says
  "Insufficient data" honestly until at least 3 real releases are stored
- New `/usd/forecasts` page shows these estimates with their rationale and
  a disclaimer
- Forecast generation now runs automatically as part of the same daily
  cron job that syncs data (`/api/sync/all`) — no extra Vercel cron job
  needed
- Run `docs/migration_forecast_engine.sql` in Supabase once to add the new
  columns this needs

## Next steps (see bottom of chat message)

