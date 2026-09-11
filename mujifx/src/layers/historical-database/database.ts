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
import type { AnalystAssessment } from "@/types/economic-data";

/**
 * Saves a normalized data point.
 *
 * Legacy/FRED ingestion must never overwrite an already-ingested authoritative
 * observation for the same indicator + period. The authoritative writer is
 * allowed to replace legacy rows, but the reverse direction is blocked here.
 * This protects source precedence while the remaining indicators are migrated
 * from legacy transport to their official source adapters.
 *
 * Uses the ADMIN client (service_role key) because writes are intentionally
 * blocked for the public/anon key by Row Level Security — see docs/schema.sql.
 * This function must only ever be called from server-side code (API routes),
 * never from a client component.
 */
export async function saveDataPoint(row: EconomicDataRow) {
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("economic_data_points")
    .select("id, data_origin")
    .eq("indicator", row.indicator)
    .eq("period_covered", row.period_covered)
    .maybeSingle();

  if (lookupError) {
    throw new Error(
      `Failed to check existing ${row.indicator} observation: ${lookupError.message}`
    );
  }

  if (existing?.data_origin?.startsWith("authoritative_")) {
    return [existing];
  }

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
 * Gets recent REAL history for one indicator, most recent first.
 * Forecast placeholders are deliberately excluded because they have
 * actual = null and must never participate in deterministic category
 * calculations or confidence checks.
 *
 * Uses period_covered rather than release_date because legacy rows may have
 * release_date populated from the observation period and authoritative rows
 * may not have a verified source release date yet.
 */
export async function getIndicatorHistory(
  indicator: IndicatorId,
  limit: number = 12
) {
  const { data, error } = await supabase
    .from("economic_data_points")
    .select("*")
    .eq("indicator", indicator)
    .not("actual", "is", null)
    .order("period_covered", { ascending: false })
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
    .not("actual", "is", null)
    .order("period_covered", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch latest indicators: ${error.message}`);
  }

  const latestByIndicator = new Map<string, (typeof data)[number]>();
  for (const row of data ?? []) {
    // Rows are ordered newest-first, so the first time we see an indicator
    // is its latest observation period — skip any further (older) rows for it.
    if (!latestByIndicator.has(row.indicator)) {
      latestByIndicator.set(row.indicator, row);
    }
  }
  return latestByIndicator;
}

/**
 * Gets the latest MUJIFX forecast row for each indicator (the "future"
 * placeholder rows saveForecast() creates — actual is null, mujifx_estimate
 * is not). Separate from getLatestForIndicators, which is for real releases.
 */
export async function getLatestForecasts(indicators: IndicatorId[]) {
  const { data, error } = await supabase
    .from("economic_data_points")
    .select("*")
    .in("indicator", indicators)
    .is("actual", null)
    .not("mujifx_estimate", "is", null)
    .order("period_covered", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch forecasts: ${error.message}`);
  }

  const latestByIndicator = new Map<string, (typeof data)[number]>();
  for (const row of data ?? []) {
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
    .not("actual", "is", null)
    .order("period_covered", { ascending: false })
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

/**
 * Saves the latest AI analyst assessment. We only keep one row (the most
 * recent), so this deletes any existing row first, then inserts fresh —
 * simpler than upsert logic for a single-row table.
 */
export async function saveAnalystAssessment(
  assessment: AnalystAssessment,
  scoreValue: number,
  scoreBias: string
) {
  await supabaseAdmin.from("analyst_assessments").delete().neq("id", 0);

  const { data, error } = await supabaseAdmin
    .from("analyst_assessments")
    .insert({
      currency: assessment.currency,
      generated_at: assessment.generatedAt,
      what_changed: assessment.whatChanged,
      why_it_changed: assessment.whyItChanged,
      economic_implications: assessment.economicImplications,
      central_bank_implications: assessment.centralBankImplications,
      market_expectations_vs_pricing: assessment.marketExpectationsVsPricing,
      cross_asset_confirmation: assessment.crossAssetConfirmation,
      contradictions: assessment.contradictions,
      risks: assessment.risks,
      final_assessment: assessment.finalAssessment,
      disclaimer: assessment.disclaimer,
      fundamental_score: scoreValue,
      fundamental_bias: scoreBias,
    })
    .select();

  if (error) {
    throw new Error(`Failed to save analyst assessment: ${error.message}`);
  }
  return data;
}

/**
 * Gets the latest saved AI analyst assessment, or null if none exists yet.
 */
export async function getLatestAnalystAssessment() {
  const { data, error } = await supabase
    .from("analyst_assessments")
    .select("*")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch analyst assessment: ${error.message}`);
  }
  return data;
}
