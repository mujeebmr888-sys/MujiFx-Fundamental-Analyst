/**
 * LAYER 6 — MARKET PRICING ASSESSMENT ENGINE
 *
 * Deterministic only. Three concepts remain strictly separate:
 * A) Market-implied policy signal (2Y yield — PRIMARY)
 * B) Yield-curve context (10Y yield + 10Y-2Y spread — CONTEXT ONLY)
 * C) Dollar market outcome (US Broad Dollar Index — OUTCOME)
 *
 * DTWEXBGS is the Federal Reserve's US Broad Dollar Index, not ICE DXY.
 */

import type {
  MarketPricingAssessment,
  AssessmentFact,
  AssessmentCalculation,
  AssessmentInterpretation,
  ConfidenceLevel,
} from "@/types/assessment";
import type { DataSourceRef } from "@/types/economic-data";

export interface MarketPricingHistoryRow {
  actual: number | null;
  previous: number | null;
  period_covered: string;
  release_date: string;
  source_name: string;
  source_url: string;
  source_tier: string;
  retrieved_at: string;
}

export interface MarketPricingEngineInput {
  treasury2y: MarketPricingHistoryRow[];
  treasury10y: MarketPricingHistoryRow[];
  usBroadDollarIndex: MarketPricingHistoryRow[];
}

function toSourceRef(row: MarketPricingHistoryRow): DataSourceRef {
  return {
    name: row.source_name,
    url: row.source_url,
    tier: row.source_tier as DataSourceRef["tier"],
    retrievedAt: row.retrieved_at,
  };
}

function realObservationsOnly(rows: MarketPricingHistoryRow[]): MarketPricingHistoryRow[] {
  return rows.filter((r) => r.actual !== null);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function trendOverAvailableSpan(
  rows: MarketPricingHistoryRow[],
  preferredObservationsBack: number
): { change: number | null; observationsSpanned: number } {
  if (rows.length > preferredObservationsBack) {
    const past = rows[preferredObservationsBack].actual;
    if (past !== null) {
      return { change: round((rows[0].actual as number) - past), observationsSpanned: preferredObservationsBack };
    }
  }
  if (rows.length > 1) {
    const availableBack = rows.length - 1;
    const past = rows[availableBack].actual;
    if (past !== null) {
      return { change: round((rows[0].actual as number) - past), observationsSpanned: availableBack };
    }
  }
  return { change: null, observationsSpanned: 0 };
}

function directionLabel(change: number | null): "rising" | "falling" | "flat" | "insufficient" {
  if (change === null) return "insufficient";
  if (change > 0) return "rising";
  if (change < 0) return "falling";
  return "flat";
}

const PREFERRED_TREND_SPAN = 3;

export function generateMarketPricingAssessment(
  input: MarketPricingEngineInput
): MarketPricingAssessment {
  const asOf = new Date().toISOString();
  const facts: AssessmentFact[] = [];
  const calculations: AssessmentCalculation[] = [];
  const interpretations: AssessmentInterpretation[] = [];
  const evidence: string[] = [];
  const conflictingEvidence: string[] = [];
  const dataLimitations: string[] = [
    "Actual ICE DXY data is not available/ingested — the US Broad Dollar Index (DTWEXBGS) is a distinct Federal Reserve index and is never treated as equivalent to DXY.",
    "Foreign interest-rate data is not ingested.",
    "Credit spreads are not ingested.",
    "Equity-market data is not ingested.",
    "Futures-implied Fed probabilities are not ingested.",
  ];

  const twoYReal = realObservationsOnly(input.treasury2y);
  const tenYReal = realObservationsOnly(input.treasury10y);
  const dollarReal = realObservationsOnly(input.usBroadDollarIndex);

  // STEP 1: 2Y YIELD — PRIMARY market-implied policy signal
  if (twoYReal.length === 0) {
    dataLimitations.push("2-Year Treasury Yield: no observations stored yet — the primary market-pricing signal is unavailable.");
  } else {
    facts.push({
      label: "2-Year Treasury Yield (latest)",
      value: twoYReal[0].actual,
      periodCovered: twoYReal[0].period_covered,
      source: toSourceRef(twoYReal[0]),
    });
  }
  const twoY = trendOverAvailableSpan(twoYReal, PREFERRED_TREND_SPAN);
  calculations.push({
    label: `2Y Treasury Yield: change over last ${twoY.observationsSpanned || PREFERRED_TREND_SPAN} observation(s)`,
    formula: `latest.actual - value_${twoY.observationsSpanned || PREFERRED_TREND_SPAN}_observations_ago`,
    result: twoY.change,
    unavailableReason: twoY.change === null ? `Need at least 2 stored observations; have ${twoYReal.length}.` : undefined,
  });
  const twoYDirection = directionLabel(twoY.change);

  let marketImpliedPolicySignal: "Hawkish-leaning" | "Dovish-leaning" | "Neutral" | "Insufficient data";
  if (twoYDirection === "insufficient") {
    marketImpliedPolicySignal = "Insufficient data";
  } else {
    marketImpliedPolicySignal =
      twoYDirection === "rising" ? "Hawkish-leaning" : twoYDirection === "falling" ? "Dovish-leaning" : "Neutral";
    interpretations.push({
      label: "Market-implied policy signal (PRIMARY, from 2Y yield)",
      rule: "The 2-Year Treasury Yield is the primary market-implied policy signal — the front end of the curve is most sensitive to near-term policy-rate expectations. Rising → Hawkish-leaning market pricing; Falling → Dovish-leaning; Flat → Neutral. This describes MARKET PRICING, not a prediction of the Fed's actual intent or decisions.",
      result: marketImpliedPolicySignal,
    });
    evidence.push(
      `2Y Treasury Yield: ${twoY.change! >= 0 ? "+" : ""}${twoY.change}pp over the last ${twoY.observationsSpanned} observations → market-implied policy pricing: ${marketImpliedPolicySignal}.`
    );
  }

  // STEP 2: 10Y YIELD — CONTEXT ONLY
  if (tenYReal.length === 0) {
    dataLimitations.push("10-Year Treasury Yield: no observations stored yet.");
  } else {
    facts.push({
      label: "10-Year Treasury Yield (latest)",
      value: tenYReal[0].actual,
      periodCovered: tenYReal[0].period_covered,
      source: toSourceRef(tenYReal[0]),
    });
  }
  const tenY = trendOverAvailableSpan(tenYReal, PREFERRED_TREND_SPAN);
  calculations.push({
    label: `10Y Treasury Yield: change over last ${tenY.observationsSpanned || PREFERRED_TREND_SPAN} observation(s)`,
    formula: `latest.actual - value_${tenY.observationsSpanned || PREFERRED_TREND_SPAN}_observations_ago`,
    result: tenY.change,
    unavailableReason: tenY.change === null ? `Need at least 2 stored observations; have ${tenYReal.length}.` : undefined,
  });
  const tenYDirection = directionLabel(tenY.change);
  if (tenYDirection !== "insufficient") {
    interpretations.push({
      label: "10Y yield trend (CONTEXT only, not the primary signal)",
      rule: "10-Year Treasury Yield reflects a broader mix of growth/inflation expectations and term premium, not policy expectations alone. Reported as context — NOT mechanically combined with the 2Y to form the primary Hawkish/Dovish assessment.",
      result: `10Y ${tenYDirection}`,
    });
    evidence.push(`10Y Treasury Yield: ${tenY.change! >= 0 ? "+" : ""}${tenY.change}pp over the last ${tenY.observationsSpanned} observations → 10Y ${tenYDirection} (context only).`);
  }

  // STEP 3: 10Y − 2Y SPREAD — CONTEXT ONLY
  let spreadNow: number | null = null;
  if (twoYReal.length > 0 && tenYReal.length > 0 && twoYReal[0].actual !== null && tenYReal[0].actual !== null) {
    spreadNow = round((tenYReal[0].actual as number) - (twoYReal[0].actual as number));
    calculations.push({
      label: "10Y − 2Y Treasury Yield Spread",
      formula: "10Y.actual - 2Y.actual",
      result: spreadNow,
    });
    interpretations.push({
      label: "Yield curve level (CONTEXT only)",
      rule: "10Y − 2Y spread. Positive = normal/upward-sloping curve; negative = inverted curve. This is context only and does not override the 2Y primary signal.",
      result: spreadNow >= 0 ? "Positive spread (normal curve)" : "Negative spread (inverted curve)",
    });
  } else {
    dataLimitations.push("10Y − 2Y spread: requires both 2Y and 10Y latest values; unavailable this run.");
  }

  // Align spread observations by actual period, never by array index.
  let spreadDirection: "widening" | "narrowing" | "flat" | "insufficient" = "insufficient";
  const twoYByPeriod = new Map<string, number>();
  for (const r of twoYReal) {
    if (r.actual !== null) twoYByPeriod.set(r.period_covered, r.actual);
  }
  const tenYByPeriod = new Map<string, number>();
  for (const r of tenYReal) {
    if (r.actual !== null) tenYByPeriod.set(r.period_covered, r.actual);
  }
  const commonPeriods = [...twoYByPeriod.keys()].filter((p) => tenYByPeriod.has(p));
  commonPeriods.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  const commonAligned = commonPeriods.map((period) => ({
    period,
    spread: round((tenYByPeriod.get(period) as number) - (twoYByPeriod.get(period) as number)),
  }));

  if (commonAligned.length < 2) {
    dataLimitations.push(
      `10Y − 2Y spread trend: insufficient common observation dates between the 2Y and 10Y series to align (found ${commonAligned.length} common date(s); need at least 2). Not invented or interpolated.`
    );
  } else {
    const latestCommon = commonAligned[0];
    const earlierIndex = commonAligned.length > PREFERRED_TREND_SPAN ? PREFERRED_TREND_SPAN : commonAligned.length - 1;
    const earlierCommon = commonAligned[earlierIndex];
    const spreadChange = round(latestCommon.spread - earlierCommon.spread);
    calculations.push({
      label: `10Y − 2Y spread: change over last ${earlierIndex} common-dated observations`,
      formula: "latest_common_spread - earlier_common_spread (10Y and 2Y aligned by period_covered, not by array position)",
      result: spreadChange,
    });
    spreadDirection = spreadChange > 0 ? "widening" : spreadChange < 0 ? "narrowing" : "flat";
    interpretations.push({
      label: "Yield curve trend (CONTEXT only)",
      rule: `Spread change between the latest common-dated 2Y/10Y observation (${latestCommon.period}) and an earlier common-dated observation (${earlierCommon.period}, ${earlierIndex} common observations back), aligned by period_covered rather than by array position. Widening/narrowing is reported as context alongside the spread level — not used to override the 2Y primary signal.`,
      result: `Spread ${spreadDirection}`,
    });
  }

  // STEP 4: US BROAD DOLLAR INDEX — MARKET OUTCOME
  if (dollarReal.length === 0) {
    dataLimitations.push("US Broad Dollar Index (DTWEXBGS): no observations stored yet.");
  } else {
    facts.push({
      label: "US Broad Dollar Index (latest)",
      value: dollarReal[0].actual,
      periodCovered: dollarReal[0].period_covered,
      source: toSourceRef(dollarReal[0]),
    });
  }
  const dollar = trendOverAvailableSpan(dollarReal, PREFERRED_TREND_SPAN);
  calculations.push({
    label: `US Broad Dollar Index: change over last ${dollar.observationsSpanned || PREFERRED_TREND_SPAN} observation(s)`,
    formula: `latest.actual - value_${dollar.observationsSpanned || PREFERRED_TREND_SPAN}_observations_ago`,
    result: dollar.change,
    unavailableReason: dollar.change === null ? `Need at least 2 stored observations; have ${dollarReal.length}.` : undefined,
  });
  const dollarDirection = directionLabel(dollar.change);
  if (dollarDirection !== "insufficient") {
    interpretations.push({
      label: "US Broad Dollar Index trend (MARKET OUTCOME, not a policy-expectations input)",
      rule: "The US Broad Dollar Index (Federal Reserve's own trade-weighted index, DTWEXBGS — NOT ICE's DXY) is treated as a market OUTCOME to be explained, not itself a policy-expectations variable. Rising → dollar strengthening; Falling → dollar weakening; Flat → dollar flat. Never averaged with the 2Y yield.",
      result: `Dollar ${dollarDirection === "rising" ? "strengthening" : dollarDirection === "falling" ? "weakening" : "flat"}`,
    });
    evidence.push(`US Broad Dollar Index: ${dollar.change! >= 0 ? "+" : ""}${dollar.change} over the last ${dollar.observationsSpanned} observations → ${dollarDirection === "rising" ? "strengthening" : dollarDirection === "falling" ? "weakening" : "flat"}.`);
  }

  // STEP 5: DOLLAR CONFIRMATION / DIVERGENCE
  if (twoYDirection !== "insufficient" && dollarDirection !== "insufficient") {
    const twoYImpliesUp = twoYDirection === "rising";
    const twoYImpliesDown = twoYDirection === "falling";
    const dollarUp = dollarDirection === "rising";
    const dollarDown = dollarDirection === "falling";
    const consistent = (twoYImpliesUp && dollarUp) || (twoYImpliesDown && dollarDown);
    const inconsistent = (twoYImpliesUp && dollarDown) || (twoYImpliesDown && dollarUp);
    if (consistent) {
      interpretations.push({
        label: "Dollar confirmation / divergence",
        rule: "Compares the 2Y-implied market-pricing direction against the US Broad Dollar Index direction. When they move consistently (2Y rising + dollar rising, or 2Y falling + dollar falling), this is reported as confirmation.",
        result: "Market pricing is confirmed by the dollar market.",
      });
      evidence.push("2Y yield direction and US Broad Dollar Index direction are consistent — market pricing is confirmed by the dollar market.");
    } else if (inconsistent) {
      interpretations.push({
        label: "Dollar confirmation / divergence",
        rule: "Compares the 2Y-implied market-pricing direction against the US Broad Dollar Index direction. When they diverge, this is flagged explicitly rather than one being assumed correct.",
        result: `Market-pricing divergence: the 2Y yield is ${twoYDirection} while the US Broad Dollar Index is ${dollarDirection}.`,
      });
      conflictingEvidence.push(
        `Market-pricing divergence: the 2Y yield is ${twoYDirection} while the US Broad Dollar Index is ${dollarDirection}. Possible (non-definitive) explanations: foreign interest-rate expectations, relative policy expectations outside the US, risk sentiment, or capital flows — none of these are confirmed causes, since foreign-market and capital-flow data are not currently ingested.`
      );
    }
  } else {
    dataLimitations.push("Dollar confirmation/divergence comparison unavailable: requires both a 2Y trend and a US Broad Dollar Index trend.");
  }

  // PRIMARY ASSESSMENT: 2Y ONLY. Context never overrides it.
  let assessment: MarketPricingAssessment["assessment"];
  if (marketImpliedPolicySignal === "Insufficient data") assessment = "Neutral";
  else if (marketImpliedPolicySignal === "Hawkish-leaning") assessment = "Hawkish";
  else if (marketImpliedPolicySignal === "Dovish-leaning") assessment = "Dovish";
  else assessment = "Neutral";

  interpretations.push({
    label: "Primary Market Pricing assessment",
    rule: "Comes from the 2Y yield trend ONLY: rising → Hawkish, falling → Dovish, flat → Neutral. 10Y yield, the 10Y−2Y spread, and the US Broad Dollar Index are reported as context and confirmation/divergence — none of them override this primary signal.",
    result: assessment,
  });

  let confidence: ConfidenceLevel;
  if (twoYDirection === "insufficient") {
    confidence = "Insufficient data";
  } else {
    const contextAvailable = [tenYDirection, dollarDirection].filter((d) => d !== "insufficient").length;
    const spreadAvailable = spreadNow !== null && spreadDirection !== "insufficient";
    if (contextAvailable === 2 && spreadAvailable) confidence = "Medium";
    else confidence = "Low";
  }

  return {
    category: "Market Pricing",
    asOf,
    facts,
    calculations,
    interpretations,
    assessment,
    confidence,
    evidence,
    conflictingEvidence,
    dataLimitations,
  };
}
