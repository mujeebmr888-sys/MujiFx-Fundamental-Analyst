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

## Status: Foundation only (Milestone 1)

This first milestone contains:
- Full folder/module structure for all 8 layers
- TypeScript types (data contracts) that every layer will use
- One working example: fetching real CPI data from FRED (free, no key needed
  for basic use... actually FRED requires a free API key — see setup docs)
- Empty dashboard shell with the navigation you specified

Nothing is hardcoded or faked. Layers that aren't built yet simply don't exist yet
rather than containing placeholder numbers.

## Tech stack

- Next.js 14 (App Router) + TypeScript — frontend + API routes
- Tailwind CSS — styling (institutional/research look, not flashy)
- Firebase Firestore — historical data storage
- Firebase Hosting + Cloud Functions — deployment + scheduled data pulls
- FRED API (St. Louis Fed) — primary free data source for CPI, PCE, NFP, GDP, Fed
  funds rate, unemployment, and more
- Treasury.gov — yield curve data

## Next steps (see bottom of chat message)

