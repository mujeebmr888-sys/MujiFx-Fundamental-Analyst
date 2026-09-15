# Step 13K — Verified Release-Date Implementation Plan

## Goal
Add verified publication/release dates without ever using an observation period as a fake release date.

## Current state
Authoritative adapters already support nullable `sourceReleaseDate` and `sourceReleaseDateVerified`. The current writer only populates `release_date` when verification is true.

## Required implementation
1. BLS: attach verified release dates using official BLS release calendars for CPI and Employment Situation data.
2. BEA: attach verified release dates using the official BEA release schedule for PCE and GDP.
3. Federal Reserve H.15: establish a verified publication-date source before populating Fed Funds release dates.
4. Keep release date null when verification is unavailable.
5. Do not backfill historical release dates from observation dates.
6. Add tests proving that unverified dates remain null and verified dates populate both source_release_date and release_date.

## Data semantics
- observation date = period covered by the economic observation
- release date = date the information became publicly available
- retrieval date = date MUJIFX fetched the source

## Point-in-time rule
Historical analysis may use an observation only when its verified release date is on or before the analysis timestamp. If release date is unknown, the observation must not be treated as point-in-time verified.

## Non-goals
- No scoring changes
- No AI prompt changes
- No FRED vintage archival expansion
- No frontend changes
