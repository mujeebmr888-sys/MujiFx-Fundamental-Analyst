/**
 * LAYER 6 (LEGACY QUICK SCORE)
 *
 * A small, transparent headline gauge shown on the dashboard. It is NOT
 * the system's fundamental engine - that is the six category engines plus
 * `orchestrator.ts`, which is what /usd and /api/assessment/usd serve.
 * This file exists only to give the homepage a one-glance summary; if the
 * two ever disagree, the orchestrator is authoritative.
 *
 * This is NOT a trade signal.
 *
 * ---------------------------------------------------------------------
 * CORRECTNESS NOTE (fixed bug)
 * ---------------------------------------------------------------------
 * This scorer previously included CPI (FRED series CPIAUCSL) and NFP
 * (PAYEMS) and read a rising value as "USD-supportive". Both are INDEX /
 * LEVEL series: CPIAUCSL rises in almost every month of a normal economy,
 * and PAYEMS rises in every month with positive job growth. The score was
 * therefore pinned bullish almost permanently, regardless of what
 * inflation or hiring were actually doing.
 *
 * "Is inflation accelerating?" and "is hiring slowing?" are questions
 * about the SECOND difference of those series, which needs more history
 * than one actual/previous pair. Rather than fabricate a signal from a
 * level, level series are now excluded here and stated as excluded. The
 * inflation and employment category engines do this properly, with the
 * required history depth - see inflation.ts and employment.ts.
 *
 * What remains below are series where a one-period change IS directly
 * meaningful because the series is already a rate or a yield.
 */

import type { FundamentalScore, IndicatorId } from "@/types/economic-data";

interface ScoringInput {
  indicator: IndicatorId;
  label: string;
  weight: number; // relative importance, arbitrary units
  // true = rising value is historically USD-supportive; false = inverse
  // (e.g. a FALLING unemployment rate is USD-supportive, so it's inverse)
  risingIsBullish: boolean;
  momChange: number | null; // from the economic-calculations layer
}

const SCORING_CONFIG: Array<Omit<ScoringInput, "momChange">> = [
  { indicator: "FED_FUNDS_RATE", label: "Fed Funds Rate", weight: 3, risingIsBullish: true },
  {
    indicator: "UNEMPLOYMENT_RATE",
    label: "Unemployment Rate",
    weight: 2,
    risingIsBullish: false,
  },
  { indicator: "TREASURY_2Y", label: "2-Year Treasury Yield", weight: 2, risingIsBullish: true },
  { indicator: "TREASURY_10Y", label: "10-Year Treasury Yield", weight: 1, risingIsBullish: true },
];

/**
 * Index/level series a one-period change cannot be honestly read from.
 * Listed explicitly so the dashboard can say WHY they are absent instead
 * of silently dropping them.
 */
const EXCLUDED_LEVEL_SERIES: Array<{ indicator: IndicatorId; label: string; reason: string }> = [
  {
    indicator: "CPI",
    label: "CPI",
    reason:
      "CPIAUCSL is a price INDEX, not an inflation rate - it rises in nearly every month, so a one-period rise says nothing about whether inflation is accelerating. Handled properly by the Inflation engine, which uses 13 months of history.",
  },
  {
    indicator: "NFP",
    label: "Nonfarm Payrolls",
    reason:
      "PAYEMS is the total employment LEVEL, not monthly job gains - it rises in every month with any positive hiring. Handled properly by the Employment engine.",
  },
];

export function computeUsdFundamentalScore(
  momChangeByIndicator: Map<IndicatorId, number | null>
): FundamentalScore {
  const breakdown: FundamentalScore["breakdown"] = [];
  let weightedSum = 0;
  let totalWeightUsed = 0;
  // Collect the USD-DIRECTION signal (+1 / -1), NOT the raw up/down
  // direction of the series.
  //
  // FIXED BUG: this used to collect the raw direction, so a falling
  // unemployment rate ("down") plus a rising Fed funds rate ("up") counted
  // as a disagreement and forced the bias to "mixed" - even though both of
  // those moves point the SAME way for the dollar. Only genuine
  // disagreements should produce "mixed".
  const usdSignals: number[] = [];

  for (const config of SCORING_CONFIG) {
    const momChange = momChangeByIndicator.get(config.indicator) ?? null;

    if (momChange === null) {
      breakdown.push({
        indicator: config.indicator,
        contribution: 0,
        weight: config.weight,
        rationale: `${config.label}: no recent-change data available yet - excluded from the score.`,
      });
      continue;
    }

    const rawDirection: "up" | "down" | "flat" =
      momChange > 0 ? "up" : momChange < 0 ? "down" : "flat";

    // Convert direction into a bullish(+1)/bearish(-1)/flat(0) signal for USD.
    let signal = 0;
    if (rawDirection === "up") signal = config.risingIsBullish ? 1 : -1;
    if (rawDirection === "down") signal = config.risingIsBullish ? -1 : 1;

    if (signal !== 0) usdSignals.push(signal);

    const contribution = signal * config.weight;
    weightedSum += contribution;
    totalWeightUsed += config.weight;

    breakdown.push({
      indicator: config.indicator,
      contribution,
      weight: config.weight,
      rationale: `${config.label} moved ${rawDirection} vs. its previous release (${momChange > 0 ? "+" : ""}${momChange}), which is historically ${
        signal > 0 ? "USD-supportive" : signal < 0 ? "USD-negative" : "neutral"
      } on its own.`,
    });
  }

  // Say out loud which series were deliberately left out, and why.
  for (const excluded of EXCLUDED_LEVEL_SERIES) {
    breakdown.push({
      indicator: excluded.indicator,
      contribution: 0,
      weight: 0,
      rationale: `${excluded.label}: excluded from this headline gauge. ${excluded.reason}`,
    });
  }

  // Normalize to a -10..+10 scale so the number is stable even when some
  // indicators are missing data.
  const score =
    totalWeightUsed > 0 ? round((weightedSum / totalWeightUsed) * 10) : 0;

  const hasBullish = usdSignals.some((s) => s > 0);
  const hasBearish = usdSignals.some((s) => s < 0);

  let overallBias: FundamentalScore["overallBias"];
  if (totalWeightUsed === 0) {
    overallBias = "mixed";
  } else if (hasBullish && hasBearish && Math.abs(score) < 5) {
    // Genuine disagreement between USD signals, and the net isn't decisive.
    overallBias = "mixed";
  } else if (Math.abs(score) <= 2) {
    overallBias = "neutral";
  } else {
    overallBias = score > 0 ? "bullish" : "bearish";
  }

  return {
    currency: "USD",
    asOf: new Date().toISOString(),
    overallBias,
    score,
    breakdown,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
