create or replace function public.save_indicator_observation_vintage_batch(p_rows jsonb)
returns bigint[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  inserted_ids bigint[] := array[]::bigint[];
  v_indicator text;
  v_observation_date date;
  v_value numeric;
  v_is_missing boolean;
  v_realtime_start date;
  v_retrieved_at timestamptz;
  v_source_name text;
  v_source_url text;
  v_source_tier text;
  v_source_version text;
  inserted_id bigint;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'vintage batch must be a JSON array';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    raise exception 'vintage batch must contain at least one row';
  end if;

  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'vintage batch cannot exceed 5000 rows';
  end if;

  for item in
    select value
    from pg_catalog.jsonb_array_elements(p_rows)
    order by (value ->> 'realtime_start')::date,
             (value ->> 'indicator'),
             (value ->> 'observation_date')::date
  loop
    v_indicator := btrim(item ->> 'indicator');
    v_observation_date := (item ->> 'observation_date')::date;
    v_value := case when item ? 'value' and item -> 'value' <> 'null'::jsonb then (item ->> 'value')::numeric else null end;
    v_is_missing := coalesce((item ->> 'is_missing')::boolean, false);
    v_realtime_start := (item ->> 'realtime_start')::date;
    v_retrieved_at := (item ->> 'retrieved_at')::timestamptz;
    v_source_name := btrim(item ->> 'source_name');
    v_source_url := btrim(item ->> 'source_url');
    v_source_tier := btrim(item ->> 'source_tier');
    v_source_version := btrim(item ->> 'source_version');

    if v_indicator is null or v_indicator = '' then
      raise exception 'vintage indicator is required';
    end if;
    if v_observation_date is null then
      raise exception 'vintage observation_date is required';
    end if;
    if v_realtime_start is null then
      raise exception 'vintage realtime_start is required';
    end if;
    if v_retrieved_at is null then
      raise exception 'vintage retrieved_at is required';
    end if;
    if v_source_name is null or v_source_name = '' or v_source_url is null or v_source_url = '' then
      raise exception 'vintage source provenance is required';
    end if;
    if v_source_tier is null or v_source_tier = '' then
      raise exception 'vintage source_tier is required';
    end if;
    if v_source_version is null or v_source_version = '' then
      raise exception 'source_version is required for point-in-time vintage storage';
    end if;
    if v_is_missing and v_value is not null then
      raise exception 'missing vintage rows must have a null value';
    end if;
    if not v_is_missing and v_value is null then
      raise exception 'non-missing vintage rows must have a value';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_indicator, 0));

    update public.indicator_observation_vintages
    set realtime_end = v_realtime_start - 1
    where indicator = v_indicator
      and observation_date = v_observation_date
      and realtime_start < v_realtime_start
      and realtime_end is null;

    insert into public.indicator_observation_vintages (
      indicator,
      observation_date,
      value,
      is_missing,
      realtime_start,
      realtime_end,
      retrieved_at,
      source_name,
      source_url,
      source_tier,
      source_version
    )
    values (
      v_indicator,
      v_observation_date,
      v_value,
      v_is_missing,
      v_realtime_start,
      null,
      v_retrieved_at,
      v_source_name,
      v_source_url,
      v_source_tier,
      v_source_version
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

    inserted_ids := inserted_ids || inserted_id;
  end loop;

  return inserted_ids;
end;
$$;

revoke execute on function public.save_indicator_observation_vintage_batch(jsonb) from public, anon, authenticated;
grant execute on function public.save_indicator_observation_vintage_batch(jsonb) to service_role;
