alter table public.indicator_observation_vintages
  add column if not exists source_version text;

create or replace function public.save_indicator_observation_vintage(
  p_indicator text,
  p_observation_date date,
  p_value numeric,
  p_is_missing boolean,
  p_realtime_start date,
  p_retrieved_at timestamptz,
  p_source_name text,
  p_source_url text,
  p_source_tier text,
  p_source_version text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_id bigint;
begin
  if p_source_version is null or btrim(p_source_version) = '' then
    raise exception 'source_version is required for point-in-time vintage storage';
  end if;

  update public.indicator_observation_vintages
  set realtime_end = p_realtime_start - interval '1 day'
  where indicator = p_indicator
    and observation_date = p_observation_date
    and realtime_start < p_realtime_start
    and realtime_end is null;

  insert into public.indicator_observation_vintages (
    indicator, observation_date, value, is_missing, realtime_start,
    realtime_end, retrieved_at, source_name, source_url, source_tier, source_version
  )
  values (
    p_indicator, p_observation_date, p_value, p_is_missing, p_realtime_start,
    null, p_retrieved_at, p_source_name, p_source_url, p_source_tier, p_source_version
  )
  on conflict (indicator, observation_date, realtime_start)
  do update set
    value = excluded.value,
    is_missing = excluded.is_missing,
    retrieved_at = excluded.retrieved_at,
    source_name = excluded.source_name,
    source_url = excluded.source_url,
    source_tier = excluded.source_tier,
    source_version = excluded.source_version
  returning id into inserted_id;

  return inserted_id;
end;
$$;

revoke all on function public.save_indicator_observation_vintage(text,date,numeric,boolean,date,timestamptz,text,text,text) from public, anon, authenticated;
revoke all on function public.save_indicator_observation_vintage(text,date,numeric,boolean,date,timestamptz,text,text,text,text) from public, anon, authenticated;
grant execute on function public.save_indicator_observation_vintage(text,date,numeric,boolean,date,timestamptz,text,text,text,text) to service_role;

revoke all on function public.get_indicator_vintage_as_of(text,date,date) from public, anon, authenticated;
grant execute on function public.get_indicator_vintage_as_of(text,date,date) to service_role;
