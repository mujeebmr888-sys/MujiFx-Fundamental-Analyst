# Step 13K — Authoritative Ingestion Writer

Status: implemented.

## Purpose

Provide one controlled server-side bridge from official-source adapters into `economic_data_points`.

## Rules

- Official observations are written with `data_origin` identifying the authoritative source.
- `source_release_date` is populated only when explicitly established from authoritative release metadata.
- `source_release_date_verified` is never inferred from an observation period.
- `source_observation_id` is retained when the source supplies a stable identifier.
- Existing `release_date` remains for compatibility while the production migration is completed.
- Consensus forecasts are not fabricated; the writer stores `null` until a verified consensus source is integrated.
- Failed observations do not stop the remaining observations in a batch.
- Every batch indicator gets an audit record in `authoritative_ingestion_runs`.

## Implementation

`src/layers/data-acquisition/authoritative-writer.ts`

Exports:

- `writeAuthoritativeObservation()` — validates and upserts one official observation.
- `writeAuthoritativeBatch()` — groups observations by indicator, writes them, and records success/partial audit status.

## Scope boundary

This step does not yet replace the existing FRED API routes, change assessment logic, or perform historical migration. Those are separate controlled steps after the writer is validated against real BLS data.
