/**
 * LAYER 3: HISTORICAL DATABASE
 * Only this file talks to the economic_data_points table.
 * Nothing upstream (scoring, AI reasoning, frontend) should write raw SQL —
 * they call these functions instead.
 */

import { supabase } from "@/config/supabase";
import type { EconomicDataRow } from "@/layers/data-normalization/normalize";
import type { IndicatorId } from "@/types/economic-data";

/**
 * Saves a normalized data point. Uses upsert on (indicator, period_covered)
 * so re-running the pipeline for the same period updates the row instead of
 * creating a duplicate — important because forecasts get revised.
 */
export async function saveDataPoint(row: EconomicDataRow) {
  const { data, error } = await supabase
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
