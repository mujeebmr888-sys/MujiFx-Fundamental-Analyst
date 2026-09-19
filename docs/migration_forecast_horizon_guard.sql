-- MIGRATION: block forecast-on-forecast chains at the data layer
--
-- ALREADY APPLIED to the live project (oybuzibmmzgqdcligcod). Committed
-- here so a fresh environment reproduces it.
--
-- WHAT WENT WRONG: between 2026-09-05 and 2026-09-10 the daily job wrote
-- CPI/NFP/PPI forecasts for 2026-10 through 2027-03, marching one month
-- further into the future each day. Forecast placeholder rows were being
-- read back as "latest data", so each day's estimate was projected off the
-- previous day's estimate instead of off real government data. 18
-- fabricated rows resulted; getLatestForecasts() ordered DESC and so
-- surfaced the most corrupted of them as "the latest forecast".
--
-- Those 18 rows have been deleted. The application-layer fixes are in
-- place (history reads exclude actual-null rows; getLatestForecasts now
-- orders ASC to take the nearest upcoming period). This trigger makes the
-- failure mode structurally impossible regardless of call-site bugs.

create or replace function enforce_forecast_horizon()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  latest_actual text;
  max_allowed text;
begin
  if new.actual is not null or new.mujifx_estimate is null then
    return new;
  end if;

  select max(period_covered) into latest_actual
  from economic_data_points
  where indicator = new.indicator
    and actual is not null;

  if latest_actual is null then
    raise exception
      'Refusing forecast for % period %: no real observation exists for this indicator to project from.',
      new.indicator, new.period_covered;
  end if;

  -- Quarterly series legitimately step three months; that is the widest
  -- cadence this system ingests.
  max_allowed := (date_trunc('month', latest_actual::date) + interval '3 months')::date::text;

  if new.period_covered > max_allowed then
    raise exception
      'Refusing forecast for % period %: latest real observation is %, so this is a forecast built on another forecast, not on government data.',
      new.indicator, new.period_covered, latest_actual;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_forecast_horizon on economic_data_points;
create trigger trg_enforce_forecast_horizon
  before insert or update on economic_data_points
  for each row
  execute function enforce_forecast_horizon();

-- One-time cleanup of any existing chain rows.
with latest_real as (
  select indicator, max(period_covered) as latest_actual_period
  from economic_data_points where actual is not null group by indicator
)
delete from economic_data_points e
using latest_real l
where e.indicator = l.indicator
  and e.actual is null
  and e.mujifx_estimate is not null
  and e.period_covered > (date_trunc('month', l.latest_actual_period::date) + interval '1 month')::date::text;
