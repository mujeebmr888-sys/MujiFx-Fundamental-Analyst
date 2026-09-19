/**
 * LAYER 5: FORECAST ENGINE
 *
 * Produces MUJIFX's OWN estimate for an indicator's next release - never a
 * copy of someone else's consensus number (we don't have free access to
 * that, and scraping it would violate other sites' terms of service).
 *
 * Method (intentionally simple and transparent, v1): look at the trend of
 * the last few releases and project it forward, using how much that trend
 * has varied historically to size the range and confidence. This is a
 * baseline model, not a sophisticated one - the rationale text says so
 * explicitly, and confidence is capped at "Medium" so it never overstates
 * itself. This can be replaced with a smarter model later without changing
 * anything outside this file.
 */

import type { IndicatorId } from "@/types/economic-data";

export interface ForecastResult {
  indicator: IndicatorId;
  forecastForPeriod: string; // e.g. "2026-08-01"
  estimate: number | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  confidence: "Insufficient data" | "Low" | "Medium";
  rationale: string;
  risks: string;
}

interface HistoricalRow {
  period_covered: string;
  actual: number | null;
}

/**
 * @param history Past releases for one indicator, ordered NEWEST FIRST
 *                (this is how getIndicatorHistory returns them).
 */
export function generateForecast(
  indicator: IndicatorId,
  history: HistoricalRow[]
): ForecastResult {
  const actuals = history
    .filter((h) => h.actual !== null)
    .map((h) => h.actual as number);

  const nextPeriod = computeNextPeriod(history[0]?.period_covered, indicator);

  const disclaimer =
    "This is MUJIFX's own model estimate based on recent trend, not a guaranteed prediction or a market consensus figure. Actual data can and does differ.";

  if (actuals.length < 3) {
    return {
      indicator,
      forecastForPeriod: nextPeriod,
      estimate: null,
      rangeLow: null,
      rangeHigh: null,
      confidence: "Insufficient data",
      rationale:
        "Not enough historical releases stored yet to model a trend (need at least 3). This will fill in automatically as more monthly releases are synced.",
      risks: disclaimer,
    };
  }

  // Newest-first -> take up to the last 6 month-over-month changes.
  const recentActuals = actuals.slice(0, 7); // need N+1 points for N diffs
  const diffs: number[] = [];
  for (let i = 0; i < recentActuals.length - 1; i++) {
    diffs.push(recentActuals[i] - recentActuals[i + 1]);
  }

  const avgDiff = average(diffs);
  const latestActual = recentActuals[0];
  const estimate = round(latestActual + avgDiff);

  const stdDev = standardDeviation(diffs);
  // Range width floors at 0.5% of the latest value so it's never a
  // suspiciously precise single point even when history is very stable.
  const rangeWidth = Math.max(stdDev, Math.abs(latestActual) * 0.005);

  const confidence: ForecastResult["confidence"] =
    diffs.length >= 6 ? "Medium" : "Low";

  return {
    indicator,
    forecastForPeriod: nextPeriod,
    estimate,
    rangeLow: round(estimate - rangeWidth),
    rangeHigh: round(estimate + rangeWidth),
    confidence,
    rationale: `Based on the average month-over-month change across the last ${diffs.length} release(s) (avg change: ${round(
      avgDiff
    )}), projected forward from the latest actual value of ${latestActual}.`,
    risks: disclaimer,
  };
}

/**
 * Release cadence per indicator, in months. Needed because the "next
 * period" for a quarterly series is three months out, not one: GDP and
 * GDP_GROWTH_RATE were previously forecast one month ahead, which produced
 * a period_covered that does not exist in the BEA calendar (e.g. a
 * "2026-05" quarter) and would have collided with the real quarter's row
 * on the (indicator, period_covered) unique constraint.
 */
const CADENCE_MONTHS: Partial<Record<IndicatorId, number>> = {
  GDP: 3,
  GDP_GROWTH_RATE: 3,
};

/** Weekly series - a monthly step is meaningless for these. */
const WEEKLY_INDICATORS: IndicatorId[] = [
  "INITIAL_JOBLESS_CLAIMS",
  "CONTINUING_CLAIMS",
];

function computeNextPeriod(latestPeriod: string | undefined, indicator: IndicatorId): string {
  if (!latestPeriod) return "unknown";

  const d = new Date(`${latestPeriod.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "unknown";

  if (WEEKLY_INDICATORS.includes(indicator)) {
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  }

  const step = CADENCE_MONTHS[indicator] ?? 1;
  // Normalize to the first of the month BEFORE stepping. Official periods
  // are always first-of-month, but a stray end-of-month date (e.g. "-01-31")
  // would otherwise overflow into the month after next.
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + step);
  return d.toISOString().slice(0, 10);
}

function average(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function standardDeviation(nums: number[]): number {
  const avg = average(nums);
  const variance = average(nums.map((n) => (n - avg) ** 2));
  return Math.sqrt(variance);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
