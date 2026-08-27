-- Run this in Supabase → SQL Editor → New Query, AFTER schema.sql has
-- already been run once. This adds columns needed for the Forecast Engine
-- (MUJIFX's own estimate, range, confidence, and rationale — see
-- docs/ARCHITECTURE.md Layer 5).

alter table economic_data_points
  add column if not exists mujifx_estimate_low numeric,
  add column if not exists mujifx_estimate_high numeric,
  add column if not exists mujifx_confidence text,   -- 'Low' | 'Medium'
  add column if not exists mujifx_rationale text,
  add column if not exists mujifx_risks text;
