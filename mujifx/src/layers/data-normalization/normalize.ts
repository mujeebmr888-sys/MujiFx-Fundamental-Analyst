/**
 * LAYER 2: DATA NORMALIZATION
 * Converts an EconomicDataPoint into the exact row shape our Supabase table expects.
 *
 * release_date is nullable because authoritative adapters must never fabricate
 * a release date from an observation period.
 */

import type { EconomicDataPoint } from "@/types/economic-data";

export interface EconomicDataRow {
  indicator: string;
  release_date: string | null;
  period_covered: string;
  previous: number | null;
  consensus_forecast: number | null;
  mujifx_estimate: number | null;
  actual: number | null;
  unit: string;
  available: boolean;
  unavailable_reason: string | null;
  source_name: string;
  source_url: string;
  source_tier: string;
  retrieved_at: string;
}

export function normalizeToRow(point: EconomicDataPoint): EconomicDataRow {
  return {
    indicator: point.indicator,
    release_date: point.releaseDate,
    period_covered: point.periodCovered,
    previous: point.previous,
    consensus_forecast: point.consensusForecast,
    mujifx_estimate: point.mujifxEstimate,
    actual: point.actual,
    unit: point.unit,
    available: point.available,
    unavailable_reason: point.unavailableReason ?? null,
    source_name: point.source.name,
    source_url: point.source.url,
    source_tier: point.source.tier,
    retrieved_at: point.source.retrievedAt,
  };
}
