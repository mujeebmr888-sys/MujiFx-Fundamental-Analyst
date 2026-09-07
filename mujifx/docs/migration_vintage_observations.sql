-- MUJIFX — Step 13F Migration: indicator_observation_vintages
-- Implements the Step 13C approved vintage-history schema.
-- Run this in Supabase: Dashboard → SQL Editor → New Query → paste → Run
-- (This file is NOT executed automatically — per Step 13F instructions,
-- it is created only, not run, as part of this step.)
--
-- This table is ADDITIVE and completely independent of `economic_data_points`.
-- Nothing in the existing schema is modified, dropped, or altered by this file.

create table if not exists indicator_observation_vintages (
  id                bigint generated always as identity primary key,

  indicator         text not null,        -- e.g. 'CPI', 'GDP_GROWTH_RATE' — matches economic_data_points.indicator convention
  observation_date  date not null,        -- which economic period this value describes (e.g. 2026-07-01 = July)

  value             numeric,              -- NULL only when is_missing = true (FRED reported ".")
  is_missing        boolean not null default false,

  realtime_start    date not null,        -- first day this value was FRED's officially current number for this period
  realtime_end      date,                 -- NULL = still current / open-ended (see partial unique index below)

  retrieved_at      timestamptz not null default now(),   -- when MUJIFX fetched THIS specific vintage row; never updated afterward

  source_name       text not null,
  source_url        text not null,
  source_tier       text not null,        -- 'TIER_1_OFFICIAL' | 'TIER_2_NEWS' | 'TIER_3_RESEARCH' — matches existing convention

  created_at        timestamptz not null default now(),

  -- Natural key: a given vintage of a given observation period is uniquely
  -- identified by WHEN it became current (realtime_start), not by
  -- realtime_end (which keeps advancing daily for the still-open vintage
  -- and would force spurious re-inserts if used as part of the key).
  constraint uq_indicator_observation_vintage
    unique (indicator, observation_date, realtime_start),

  -- Strict two-way value/is_missing consistency: a missing vintage must
  -- have a NULL value, and a non-missing vintage must have a real value —
  -- "is_missing = false" with "value IS NULL" is impossible.
  constraint chk_value_consistency
    check (
      (is_missing = true  and value is null)
      or
      (is_missing = false and value is not null)
    ),

  -- Logical ordering: an end date can never precede its own start date.
  constraint chk_realtime_end_after_start
    check (realtime_end is null or realtime_end >= realtime_start)
);

-- Data-integrity guarantee: at most ONE currently-open (realtime_end IS
-- NULL) vintage may exist per (indicator, observation_date) at any time.
-- This also doubles as the fast lookup path for "what is the current
-- value right now" — functionally the vintage-aware equivalent of what
-- economic_data_points already provides for the single-version model.
create unique index if not exists uq_one_open_vintage_per_period
  on indicator_observation_vintages (indicator, observation_date)
  where realtime_end is null;

-- Supports "latest value as of timestamp T" queries that are not pinned
-- to one specific observation_date (order by observation_date desc,
-- realtime_start desc).
create index if not exists idx_vintage_indicator_obsdate_realtime
  on indicator_observation_vintages (indicator, observation_date desc, realtime_start desc);

-- Row Level Security: mirrors the existing economic_data_points policy
-- exactly — public read (this is public research data), writes restricted
-- to server-side code using the service role key only.
alter table indicator_observation_vintages enable row level security;

create policy "Public can read vintage observations"
  on indicator_observation_vintages for select
  using (true);

-- No insert/update policy for the anon key, intentionally — matches
-- economic_data_points' existing convention (writes only via the service
-- role key, never exposed to the browser).
