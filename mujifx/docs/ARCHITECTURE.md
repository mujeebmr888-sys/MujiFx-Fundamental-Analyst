# Architecture

## Why separate layers at all?

Because an analyst's job has distinct steps, and mixing them creates two problems:
bad data quietly becoming a "confident" opinion, and one bug breaking everything.
Keeping them separate means we can test, verify, and even swap out each step
independently. Example: if FRED changes its API, only `data-acquisition` changes —
nothing else needs to know.

## Layer 1 — Data Acquisition (`src/layers/data-acquisition/`)

Talks to external APIs. Nothing else. Does not interpret, score, or judge data.
Each source (FRED, BLS, BEA, Treasury) gets its own file in `sources/` so they can
fail or be rate-limited independently.

**Rule:** if a source is down or a series is missing, this layer returns an explicit
`{ available: false, reason: "..." }` — it never invents a number.

## Layer 2 — Data Normalization (`src/layers/data-normalization/`)

Raw API responses look different for every source (dates formatted differently,
different field names, different units). This layer converts everything into one
shape defined in `src/types/economic-data.ts`, so every later layer only needs to
understand ONE format.

## Layer 3 — Historical Database (`src/layers/historical-database/`)

Stores normalized data points in Firestore, keyed by indicator + release date.
This is what lets the system say "CPI has trended down for 4 straight months"
instead of judging one release in isolation (your requirement #9).

## Layer 4 — Economic Calculations (`src/layers/economic-calculations/`)

Pure math, no opinions: surprise (actual − forecast), month-over-month change,
year-over-year change, trend direction, rate-of-change acceleration/deceleration.

## Layer 5 — Forecast Engine (`src/layers/forecast-engine/`)

For major releases (CPI, NFP, PPI), produces MUJIFX's own estimate BEFORE the
release, along with a range, a confidence level, and the leading indicators that
informed it. Always framed as an estimate, never a certainty (your requirement #7).

## Layer 6 — Fundamental Scoring (`src/layers/fundamental-scoring/`)

Converts calculated indicators into a weighted bias score using the methodology
we discussed (interest-rate decisions weighted highest, minor indicators lowest).
Outputs a transparent breakdown, not just one number — so the AI layer can explain
*why*.

## Layer 7 — AI Analyst Reasoning (`src/layers/ai-analyst-reasoning/`)

Takes the score + underlying data and writes it up in analyst language, following
the exact reasoning chain you specified:
`DATA → what changed → why → economic implications → Fed implications → market
expectations → market pricing → cross-asset confirmation → currency implications
→ contradictions → risks → final assessment`.

This layer is explicitly instructed (in its system prompt, once built) to never
issue buy/sell language and to cite which layer/source each claim came from.

## Layer 8 — Frontend Dashboard (`src/app/`)

Next.js pages matching your requested navigation: Dashboard / USD / Inflation /
Employment / Growth / Federal Reserve / Market / Forecasts / Research.
