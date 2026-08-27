/**
 * LAYER 4: ECONOMIC CALCULATIONS
 * Pure math derived from data we actually have. No opinions, no fabricated
 * forecasts — if we don't have a consensus forecast (FRED doesn't provide
 * one), "surprise" is honestly null, not guessed.
 */

import type { IndicatorId, DerivedMetrics } from "@/types/economic-data";

interface CalcInput {
  indicator: IndicatorId;
  releaseDate: string;
  actual: number | null;
  previous: number | null;
  consensusForecast: number | null;
  // Chronological history (oldest→newest not required; we only need one
  // point ~12 releases back for a rough YoY comparison where available).
  priorYearActual?: number | null;
}

export function calculateDerivedMetrics(input: CalcInput): DerivedMetrics {
  const { indicator, releaseDate, actual, previous, consensusForecast, priorYearActual } =
    input;

  const surprise =
    actual !== null && consensusForecast !== null
      ? round(actual - consensusForecast)
      : null;

  const surprisePct =
    surprise !== null && consensusForecast !== null && consensusForecast !== 0
      ? round((surprise / Math.abs(consensusForecast)) * 100)
      : null;

  const momChange =
    actual !== null && previous !== null ? round(actual - previous) : null;

  const yoyChange =
    actual !== null && priorYearActual !== null && priorYearActual !== undefined
      ? round(actual - priorYearActual)
      : null;

  let trendDirection: DerivedMetrics["trendDirection"] = "unknown";
  if (momChange !== null) {
    if (momChange > 0) trendDirection = "up";
    else if (momChange < 0) trendDirection = "down";
    else trendDirection = "flat";
  }

  return {
    indicator,
    releaseDate,
    surprise,
    surprisePct,
    momChange,
    yoyChange,
    trendDirection,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
