-- Run this in Supabase → SQL Editor, after the previous migrations.
-- Stores the latest AI-generated analyst assessment (Layer 7) as a single
-- row that gets replaced each time the daily job runs. We only need the
-- most recent one, not a history, so a single-row table is simplest.

create table if not exists analyst_assessments (
  id bigint generated always as identity primary key,
  currency text not null default 'USD',
  generated_at timestamptz not null default now(),

  what_changed text not null,
  why_it_changed text not null,
  economic_implications text not null,
  central_bank_implications text not null,
  market_expectations_vs_pricing text not null,
  cross_asset_confirmation text not null,
  contradictions text not null,
  risks text not null,
  final_assessment text not null,
  disclaimer text not null,

  fundamental_score numeric,
  fundamental_bias text
);

alter table analyst_assessments enable row level security;

create policy "Public can read analyst assessments"
  on analyst_assessments for select
  using (true);

-- No public insert/update policy — only the service_role key (server-side)
-- can write, same pattern as economic_data_points.
