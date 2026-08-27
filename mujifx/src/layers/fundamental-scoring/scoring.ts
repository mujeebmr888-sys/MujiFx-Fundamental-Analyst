/**
 * LAYER 6: FUNDAMENTAL SCORING
 *
 * Converts indicator trends into a transparent, weighted USD bias score.
 * This encodes a standard, well-known macro heuristic (stronger data →
 * more likely the Fed stays hawkish/higher-for-longer → historically
 * supportive of the dollar), not a proprietary trading signal. Every
 * component of the score is shown with its own rationale — nothing is
 * hidden inside a black-box number.
 *
 * This is NOT a trade signal. It is a structured summary of what the
 * underlying data says, exactly as the product spec requires.
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
  { indicator: "CPI", label: "CPI", weight: 2, risingIsBullish: true },
  { indicator: "NFP", label: "Nonfarm Payrolls", weight: 2, risingIsBullish: true },
  {
    indicator: "UNEMPLOYMENT_RATE",
    label: "Unemployment Rate",
    weight: 2,
    risingIsBullish: false,
  },
  { indicator: "TREASURY_10Y", label: "10-Year Treasury Yield", weight: 1, risingIsBullish: true },
];

export function computeUsdFundamentalScore(
  momChangeByIndicator: Map<IndicatorId, number | null>
): FundamentalScore {
  const breakdown: FundamentalScore["breakdown"] = [];
  let weightedSum = 0;
  let totalWeightUsed = 0;
  const directions: Array<"up" | "down" | "flat"> = [];

  for (const config of SCORING_CONFIG) {
    const momChange = momChangeByIndicator.get(config.indicator) ?? null;

    if (momChange === null) {
      breakdown.push({
        indicator: config.indicator,
        contribution: 0,
        weight: config.weight,
        rationale: `${config.label}: no recent-change data available yet — excluded from the score.`,
      });
      continue;
    }

    const rawDirection: "up" | "down" | "flat" =
      momChange > 0 ? "up" : momChange < 0 ? "down" : "flat";
    directions.push(rawDirection);

    // Convert direction into a bullish(+1)/bearish(-1)/flat(0) signal for USD.
    let signal = 0;
    if (rawDirection === "up") signal = config.risingIsBullish ? 1 : -1;
    if (rawDirection === "down") signal = config.risingIsBullish ? -1 : 1;

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

  // Normalize to a -10..+10 scale so the number is stable even when some
  // indicators are missing data.
  const score =
    totalWeightUsed > 0 ? round((weightedSum / totalWeightUsed) * 10) : 0;

  const uniqueDirections = new Set(directions);
  let overallBias: FundamentalScore["overallBias"];
  if (totalWeightUsed === 0) {
    overallBias = "mixed";
  } else if (Math.abs(score) <= 2) {
    overallBias = "neutral";
  } else if (uniqueDirections.size > 1 && Math.abs(score) < 5) {
    // Directions disagree and the net score isn't strongly one-sided.
    overallBias = "mixed";
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
