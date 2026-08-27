/**
 * LAYER 3: HISTORICAL DATABASE
 * Only this file talks to the economic_data_points table.
 * Nothing upstream (scoring, AI reasoning, frontend) should write raw SQL —
 * they call these functions instead.
 */

import { supabase } from "@/config/supabase";
import { supabaseAdmin } from "@/config/supabase-admin";
import type { EconomicDataRow } from "@/layers/data-normalization/normalize";
import type { IndicatorId } from "@/types/economic-data";
import type { ForecastResult } from "@/layers/forecast-engine/forecast";

/**
 * Saves a normalized data point. Uses upsert on (indicator, period_covered)
 * so re-running the pipeline for the same period updates the row instead of
 * creating a duplicate — important because forecasts get revised.
 *
 * Uses the ADMIN client (service_role key) because writes are intentionally
 * blocked for the public/anon key by Row Level Security — see docs/schema.sql.
 * This function must only ever be called from server-side code (API routes),
 * never from a client component.
 */
export async function saveDataPoint(row: EconomicDataRow) {
  const { data, error } = await supabaseAdmin
    .from("economic_data_points")
    .upsert(row, { onConflict: "indicator,period_covered" })
    .select();

  if (error) {
    throw new Error(`Failed to save ${row.indicator}: ${error.message}`);
  }
  return data;
}

/**
 * Gets recent history for one indicator, most recent first.
 * Used for trend detection (requirement #9 — never judge one release alone).
 */
export async function getIndicatorHistory(
  indicator: IndicatorId,
  limit: number = 12
) {
  const { data, error } = await supabase
    .from("economic_data_points")
    .select("*")
    .eq("indicator", indicator)
    .order("release_date", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch history for ${indicator}: ${error.message}`);
  }
  return data;
}

/**
 * Gets the latest data point for MANY indicators in a single database query
 * (instead of one query per indicator). Returns a map keyed by indicator —
 * indicators with no data yet simply won't have a key, so callers should
 * check for undefined rather than assuming every indicator is present.
 */
export async function getLatestForIndicators(indicators: IndicatorId[]) {
  const { data, error } = await supabase
    .from("economic_data_points")
    .select("*")
    .in("indicator", indicators)
    .order("release_date", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch latest indicators: ${error.message}`);
  }

  const latestByIndicator = new Map<string, (typeof data)[number]>();
  for (const row of data ?? []) {
    // Rows are ordered newest-first, so the first time we see an indicator
    // is its latest release — skip any further (older) rows for it.
    if (!latestByIndicator.has(row.indicator)) {
      latestByIndicator.set(row.indicator, row);
    }
  }
  return latestByIndicator;
}

/**
 * Gets the single latest data point for an indicator, or null if none exists
 * yet. Never returns fabricated data — an empty database means null, not a
 * fake number.
 */
export async function getLatestDataPoint(indicator: IndicatorId) {
  const { data, error } = await supabase
    .from("economic_data_points")
    .select("*")
    .eq("indicator", indicator)
    .order("release_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch latest for ${indicator}: ${error.message}`);
  }
  return data;
}

/**
 * Saves a MUJIFX forecast as an upcoming row (actual stays null — it hasn't
 * been released yet). If a row for that future period already exists (e.g.
 * from a previous forecast run), this updates just the forecast fields
 * without disturbing anything else.
 */
export async function saveForecast(forecast: ForecastResult) {
  if (forecast.estimate === null) {
    // Insufficient data — nothing to save yet, and that's an honest,
    // expected state, not an error.
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("economic_data_points")
    .upsert(
      {
        indicator: forecast.indicator,
        period_covered: forecast.forecastForPeriod,
        release_date: forecast.forecastForPeriod,
        actual: null,
        available: false,
        unavailable_reason:
          "Not yet released. Showing MUJIFX's model estimate below — not confirmed government data.",
        unit: "",
        source_name: "MUJIFX Forecast Engine (internal model)",
        source_url: "",
        source_tier: "TIER_3_RESEARCH",
        retrieved_at: new Date().toISOString(),
        mujifx_estimate: forecast.estimate,
        mujifx_estimate_low: forecast.rangeLow,
        mujifx_estimate_high: forecast.rangeHigh,
        mujifx_confidence: forecast.confidence,
        mujifx_rationale: forecast.rationale,
        mujifx_risks: forecast.risks,
      },
      { onConflict: "indicator,period_covered" }
    )
    .select();

  if (error) {
    throw new Error(`Failed to save forecast for ${forecast.indicator}: ${error.message}`);
  }
  return data;
}
