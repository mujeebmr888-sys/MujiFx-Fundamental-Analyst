-- MUJIFX Fundamental Analyst — Database Schema
-- Run this in Supabase: Dashboard → SQL Editor → New Query → paste → Run

-- One row = one economic data release for one indicator.
-- This mirrors the EconomicDataPoint type in src/types/economic-data.ts exactly,
-- so the normalization layer can insert rows without any translation guesswork.

create table if not exists economic_data_points (
  id bigint generated always as identity primary key,

  indicator text not null,             -- e.g. 'CPI', 'NFP', 'FED_FUNDS_RATE'
  release_date date not null,          -- date the data was actually released
  period_covered text not null,        -- e.g. '2026-07' for July data

  previous numeric,
  consensus_forecast numeric,
  mujifx_estimate numeric,
  actual numeric,

  unit text not null default '',

  available boolean not null default true,
  unavailable_reason text,

  source_name text not null,
  source_url text not null,
  source_tier text not null,           -- 'TIER_1_OFFICIAL' | 'TIER_2_NEWS' | 'TIER_3_RESEARCH'
  retrieved_at timestamptz not null default now(),

  created_at timestamptz not null default now(),

  -- One release per indicator per period — re-running the pipeline updates
  -- the existing row instead of creating duplicates.
  unique (indicator, period_covered)
);

-- Fast lookups when a dashboard page asks "give me CPI history"
create index if not exists idx_economic_data_indicator
  on economic_data_points (indicator, release_date desc);

-- Row Level Security: allow public read (this is public research data),
-- but only allow writes from the backend (service role), not the browser.
alter table economic_data_points enable row level security;

create policy "Public can read economic data"
  on economic_data_points for select
  using (true);

-- No insert/update policy for the anon key on purpose — inserts should only
-- happen from server-side code using the service role key (never exposed
-- to the browser). See docs/DATA_SOURCES.md and the data-acquisition layer.
