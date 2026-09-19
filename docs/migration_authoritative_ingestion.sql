-- MIGRATION: authoritative ingestion plane
--
-- WHY THIS EXISTS
-- src/layers/data-acquisition/authoritative-writer.ts and
-- src/layers/historical-database/database.ts both read/write columns that
-- were never added to economic_data_points by docs/schema.sql or any other
-- migration in this repo. Without this file EVERY authoritative sync route
-- and EVERY /api/sync/all run fails at runtime with
--   "column economic_data_points.data_origin does not exist"
-- and the audit write fails with
--   "relation authoritative_ingestion_runs does not exist".
--
-- Run this in Supabase -> SQL Editor AFTER docs/schema.sql and
-- docs/migration_forecast_engine.sql.

-- ---------------------------------------------------------------------------
-- 1. Provenance columns used by writeAuthoritativeObservation()
-- ---------------------------------------------------------------------------
alter table economic_data_points
  add column if not exists data_origin text not null default 'legacy_fred',
  add column if not exists source_release_date date,
  add column if not exists source_release_date_verified boolean not null default false,
  add column if not exists source_observation_id text;

comment on column economic_data_points.data_origin is
  'Which ingestion path wrote this row: legacy_fred, or authoritative_<agency>. saveDataPoint() refuses to let a legacy row overwrite an authoritative_* row.';
comment on column economic_data_points.source_release_date is
  'Release date as explicitly published by the official source. NEVER inferred from period_covered.';
comment on column economic_data_points.source_release_date_verified is
  'True only when source_release_date came from authoritative release metadata.';

-- ---------------------------------------------------------------------------
-- 2. release_date must be nullable
--
-- The authoritative writer deliberately writes release_date = NULL when the
-- source has not verified a release date (observation date must never be
-- used as a release date). schema.sql declared it "not null", so every
-- unverified authoritative write would violate the constraint.
-- ---------------------------------------------------------------------------
alter table economic_data_points
  alter column release_date drop not null;

-- ---------------------------------------------------------------------------
-- 3. Ingestion audit table written by writeAuthoritativeBatch()
-- ---------------------------------------------------------------------------
create table if not exists authoritative_ingestion_runs (
  id bigint generated always as identity primary key,
  source_name text not null,
  indicator text not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  status text not null,            -- 'success' | 'partial'
  rows_seen integer not null default 0,
  rows_written integer not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ingestion_runs_indicator
  on authoritative_ingestion_runs (indicator, completed_at desc);

alter table authoritative_ingestion_runs enable row level security;

-- Audit rows are operational metadata, readable so the dashboard can show
-- "last successfully ingested at". Writes remain service-role only.
drop policy if exists "Public can read ingestion runs" on authoritative_ingestion_runs;
create policy "Public can read ingestion runs"
  on authoritative_ingestion_runs for select
  using (true);

-- ---------------------------------------------------------------------------
-- 4. Index supporting the point-in-time / latest-per-indicator reads
--    (getIndicatorHistory + getLatestForIndicators order by period_covered)
-- ---------------------------------------------------------------------------
create index if not exists idx_economic_data_period
  on economic_data_points (indicator, period_covered desc);
