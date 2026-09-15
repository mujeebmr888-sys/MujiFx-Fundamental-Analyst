drop function if exists public.get_indicator_vintage_as_of(text,date,date);

create function public.get_indicator_vintage_as_of(
  p_indicator text,
  p_observation_date date,
  p_as_of_date date
)
returns table (
  id bigint,
  indicator text,
  observation_date date,
  value numeric,
  is_missing boolean,
  realtime_start date,
  realtime_end date,
  retrieved_at timestamptz,
  source_name text,
  source_url text,
  source_tier text,
  source_version text
)
language sql
security definer
set search_path = ''
as $$
  select v.id, v.indicator, v.observation_date, v.value, v.is_missing,
         v.realtime_start, v.realtime_end, v.retrieved_at,
         v.source_name, v.source_url, v.source_tier, v.source_version
  from public.indicator_observation_vintages v
  where v.indicator = p_indicator
    and v.observation_date = p_observation_date
    and v.realtime_start <= p_as_of_date
    and (v.realtime_end is null or v.realtime_end >= p_as_of_date)
  order by v.realtime_start desc
  limit 1;
$$;

revoke all on function public.get_indicator_vintage_as_of(text,date,date) from public, anon, authenticated;
grant execute on function public.get_indicator_vintage_as_of(text,date,date) to service_role;
