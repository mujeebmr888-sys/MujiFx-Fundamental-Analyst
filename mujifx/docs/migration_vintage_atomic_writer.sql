-- MUJIFX — Step 13G atomic vintage writer
-- Run AFTER migration_vintage_observations.sql in Supabase SQL Editor.
-- This is additive: it creates/replaces only the narrow writer function.

create or replace function save_indicator_observation_vintage(
  p_indicator text,
  p_observation_date date,
  p_value numeric,
  p_is_missing boolean,
  p_realtime_start date,
  p_retrieved_at timestamptz,
  p_source_name text,
  p_source_url text,
  p_source_tier text
)
returns indicator_observation_vintages
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_row indicator_observation_vintages%rowtype;
  inserted_row indicator_observation_vintages%rowtype;
  lock_key bigint;
begin
  if p_is_missing and p_value is not null then
    raise exception 'Missing vintage cannot contain a value';
  end if;

  if not p_is_missing and p_value is null then
    raise exception 'Non-missing vintage must contain a value';
  end if;

  lock_key := hashtextextended(
    p_indicator || ':' || p_observation_date::text,
    0
  );
  perform pg_advisory_xact_lock(lock_key);

  select * into existing_row
  from indicator_observation_vintages
  where indicator = p_indicator
    and observation_date = p_observation_date
    and realtime_start = p_realtime_start;

  if found then
    return existing_row;
  end if;

  update indicator_observation_vintages
  set realtime_end = p_realtime_start - 1
  where indicator = p_indicator
    and observation_date = p_observation_date
    and realtime_end is null
    and realtime_start < p_realtime_start;

  insert into indicator_observation_vintages (
    indicator,
    observation_date,
    value,
    is_missing,
    realtime_start,
    realtime_end,
    retrieved_at,
    source_name,
    source_url,
    source_tier
  ) values (
    p_indicator,
    p_observation_date,
    p_value,
    p_is_missing,
    p_realtime_start,
    null,
    p_retrieved_at,
    p_source_name,
    p_source_url,
    p_source_tier
  )
  returning * into inserted_row;

  return inserted_row;
end;
$$;

revoke all on function save_indicator_observation_vintage(
  text, date, numeric, boolean, date, timestamptz, text, text, text
) from public;
