# MUJIFX Fundamental Analyst - USD Module

An institutional-style **fundamental research** application (NOT a signal generator).
It analyzes US macroeconomic data the way an experienced macro/fundamental analyst
would: it reads data, compares it to expectations, checks the Fed's stance, confirms
with market pricing (yields, DXY), and produces a written assessment - never a
"buy/sell" call.

## Core principle

This app never outputs trade signals, guaranteed predictions, or fabricated numbers.
Every claim must be traceable to a real source, or explicitly marked
`"Data unavailable / source not verified."`

## Architecture (8 separated layers)

Data flows through these layers in order. Each layer only talks to the layer next
to it - this keeps the system honest and debuggable.

```
1. data-acquisition       -> pulls raw data from FRED, BLS, BEA, Treasury.gov
2. data-normalization      -> converts raw API responses into one common shape
3. historical-database     -> stores normalized data in Firestore over time
4. economic-calculations   -> derives things like surprise = actual - forecast
5. forecast-engine         -> MUJIFX's own model estimate + confidence + range
6. fundamental-scoring     -> turns indicators into a weighted bias score
7. ai-analyst-reasoning    -> turns the score + data into written analyst commentary
8. frontend dashboard      -> displays everything (Next.js app)
```

See `docs/ARCHITECTURE.md` for details on each layer and `docs/DATA_SOURCES.md`
for exactly which free APIs feed which economic indicator.

## Status: Milestone 2 done - first real end-to-end pipeline

- Full folder/module structure for all 8 layers
- TypeScript types (data contracts) that every layer uses
- Layer 1: real FRED API client
- Layer 2: normalization (FRED shape -> database row shape)
- Layer 3: Supabase (Postgres) historical database, with schema in `docs/schema.sql`
- One working end-to-end route: `/api/sync/cpi` pulls real CPI data from FRED
  and saves it to Supabase
- Dashboard homepage reads the latest CPI value from the real database (shows
  "no data yet" honestly if the pipeline hasn't been run - never a fake number)

Nothing is hardcoded or faked. Layers that aren't built yet simply don't exist yet
rather than containing placeholder numbers.

## Tech stack

- Next.js 14 (App Router) + TypeScript - frontend + API routes
- Tailwind CSS - styling (institutional/research look, not flashy)
- Supabase (Postgres) - historical data storage
- FRED API (St. Louis Fed) - primary free data source for CPI, PCE, NFP, GDP, Fed
  funds rate, unemployment, and more
- Treasury.gov - yield curve data (not wired up yet)

## Setup after downloading/updating this project

### 1. Database migrations - run in Supabase -> SQL Editor, IN THIS ORDER

| # | File | What it adds |
|---|------|--------------|
| 1 | `docs/schema.sql` | `economic_data_points` base table |
| 2 | `docs/migration_forecast_engine.sql` | MUJIFX forecast columns |
| 3 | `docs/migration_vintage_observations.sql` | point-in-time vintage table |
| 4 | `docs/migration_point_in_time_vintage_query.sql` | vintage query function |
| 5 | `docs/migration_vintage_atomic_writer.sql` | atomic vintage writer |
| 6 | `supabase/migrations/*.sql` | vintage source-version columns (by filename order) |
| 7 | **`docs/migration_authoritative_ingestion.sql`** | **REQUIRED.** `data_origin`, `source_release_date`, `source_release_date_verified`, `source_observation_id`, makes `release_date` nullable, creates `authoritative_ingestion_runs` |
| 8 | `docs/migration_ai_analyst.sql` | `analyst_assessments` table |
| 9 | **`docs/migration_analyst_orchestrator.sql`** | **REQUIRED.** `overall_condition`, `overall_confidence`, `decision_rule`, `sources_used` |

Steps 7 and 9 are not optional. Without step 7 every authoritative sync
route fails with `column economic_data_points.data_origin does not exist`;
without step 9 the research note cannot record which condition it describes.

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill it in. Every variable is
documented in that file. Minimum to run anything:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` - reads
- `SUPABASE_SERVICE_ROLE_KEY` - **every write goes through this**; RLS
  blocks anon writes by design. Server-side only, never `NEXT_PUBLIC_`.
- `CRON_SECRET` - **required**. All `/api/sync/*` routes refuse to run
  without it (`503`). Generate one with `openssl rand -hex 32`.
- `FRED_API_KEY` - legacy sync + backfill paths
- `CENSUS_API_KEY` - authoritative retail sales
- `BEA` - **required** for the GDP and PCE authoritative routes; the BEA API
  rejects unauthenticated requests. The variable is literally named `BEA`.
- `BLS` - recommended; without it BLS API v2 is capped at 25 requests/day
  and 10 years of history. The variable is literally named `BLS`.
- `GEMINI_API_KEY` - optional; only the written research note needs it.
  Without it the data pipeline still runs and the note is skipped.

### 3. Run

```
npm install
npm run dev
```

### 4. Load real data

Sync routes are protected, so call them with the secret:

```
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/sync/all
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/sync/backfill
```

For local poking without a secret, set `ALLOW_UNPROTECTED_SYNC=1` in
`.env.local`. Never set that in production.

Then visit `http://localhost:3000/usd` for the assessment engine output.

### What you'll see before any data is loaded

Empty categories report **"Insufficient data"** with their limitations
listed. That is the correct, intended behaviour - the engines never
substitute a guess for a missing series.

## Pages

| Route | Shows |
|-------|-------|
| `/` | Indicator grid + overall condition summary + legacy quick gauge |
| `/usd` | **Overall USD Fundamental Condition** - the orchestrator, with its full reasoning chain |
| `/usd/inflation`, `/usd/employment`, `/usd/growth`, `/usd/fed`, `/usd/market`, `/usd/risk` | One category engine each, full chain |
| `/usd/forecasts` | MUJIFX model estimates |
| `/usd/research` | AI write-up of the engine's verdict |

## API

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /api/assessment/usd` | open (read-only) | Full orchestrator output |
| `GET /api/assessment/[category]` | open (read-only) | One category: `inflation`, `employment`, `growth`, `monetary-policy`, `market-pricing`, `risk-environment` |
| `GET /api/sync/*` | `Bearer $CRON_SECRET` | All ingestion. Fail-closed. |

## Two scoring systems - which one counts

`orchestrator.ts` (six category engines, four named rules, no averaging) is
**authoritative**. `scoring.ts` is a legacy headline gauge kept only for the
one-glance card on the homepage, and is labelled as such in the UI. Where
they differ, the orchestrator is right.

## Status: Milestone 9 - AI Analyst Reasoning (Layer 7) - the full pipeline is complete

- Layer 7 uses Google Gemini's free tier (not Anthropic) to keep this
  free-first - one call/day comfortably fits the free quota
- The model is given ONLY the real numbers already verified by Layers 1-6
  (indicator data + fundamental score breakdown) and is instructed never to
  invent data, never give trade advice, and never claim certainty; output
  is validated (all required fields must be present as strings) before
  being saved - if validation fails, nothing is shown rather than showing
  a malformed result
- New `/usd/research` page shows the full written assessment following the
  exact reasoning chain from the spec: what changed -> why -> economic
  implications -> central bank implications -> market expectations vs.
  pricing -> cross-asset confirmation -> contradictions -> risks -> final
  assessment
- Runs automatically as the last step of the daily `/api/sync/all` cron job
- Fixed a data-model bug: forecast placeholder rows (future periods with no
  actual value yet) could have been picked up as "latest data" on the main
  dashboard once forecasts started saving. `getLatestForIndicators` /
  `getLatestDataPoint` now explicitly exclude rows with no actual value; a
  new `getLatestForecasts` function is used specifically by the Forecasts
  page instead.
- Run `docs/migration_ai_analyst.sql` in Supabase once to add the new table
  this needs, and set `GEMINI_API_KEY` (free, from
  https://aistudio.google.com/app/apikey) in Vercel

## Next steps (see bottom of chat message)
