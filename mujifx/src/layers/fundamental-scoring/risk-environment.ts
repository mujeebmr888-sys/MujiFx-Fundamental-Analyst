/**
 * LAYER 6 — RISK ENVIRONMENT ASSESSMENT ENGINE
 *
 * Implements the Risk Environment section of
 * docs/methodology_fundamental_scoring.md and the Step 7 specification
 * EXACTLY. Deterministic only — no AI, no invented indicators, no new data
 * sources. Pure function: takes already-fetched VIX history as input, same
 * architectural pattern as inflation.ts/employment.ts/growth.ts/
 * monetary-policy.ts/market-pricing.ts.
 *
 * VIX (FRED VIXCLS, CBOE data distributed through FRED) is the ONLY
 * risk-environment indicator available this milestone. Equity data, credit
 * spreads, market breadth, put/call ratios, other volatility indices, and
 * any AI-derived risk signal are explicitly NOT used. This engine honestly
 * states that the full risk environment is not yet available rather than
 * pretending VIX alone represents global risk sentiment.
 *
 * IMPORTANT: this engine's output is CONTEXTUAL ONLY. It is intentionally
 * NOT mechanically converted into a USD bullish/bearish read anywhere in
 * this file, and it must not be folded into the Overall USD Fundamental
 * Condition — the USD can behave differently across risk regimes depending
 * on relative monetary policy, global growth, liquidity, and capital
 * flows, so that relationship is not hardcoded here.
 */

import type {
  RiskEnvironmentAssessment,
  AssessmentFact,
  AssessmentCalculation,
  AssessmentInterpretation,
  ConfidenceLevel,
} from "@/types/assessment";
import type { DataSourceRef } from "@/types/economic-data";

/** Minimal shape this engine needs from a stored release row (newest-first arrays, matching getIndicatorHistory's ordering). */
export interface RiskEnvironmentHistoryRow {
  actual: number | null;
  previous: number | null;
  period_covered: string;
  release_date: string;
  source_name: string;
  source_url: string;
  source_tier: string;
  retrieved_at: string;
}

export interface RiskEnvironmentEngineInput {
  vix: RiskEnvironmentHistoryRow[];
}

/**
 * MARKET CONVENTION BANDS — not official CBOE/Fed thresholds. Widely used
 * across trading-desk and financial-media commentary, but no single
 * official body defines them; kept as named, adjustable constants rather
 * than embedded magic numbers.
 */
const VIX_LOW_THRESHOLD = 15;
const VIX_NORMAL_UPPER_THRESHOLD = 20;
const VIX_ELEVATED_UPPER_THRESHOLD = 30;

function toSourceRef(row: RiskEnvironmentHistoryRow): DataSourceRef {
  return {
    name: row.source_name,
    url: row.source_url,
    tier: row.source_tier as DataSourceRef["tier"],
    retrievedAt: row.retrieved_at,
  };
}

/** Only real releases — defensively excludes forecast placeholder rows (actual: null) that can share this table. */
function realReleasesOnly(rows: RiskEnvironmentHistoryRow[]): RiskEnvironmentHistoryRow[] {
  return rows.filter((r) => r.actual !== null);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Change over `releasesBack` releases, falling back to whatever shorter span is actually available rather than inventing missing history. */
function changeOverAvailableSpan(
  rows: RiskEnvironmentHistoryRow[],
  preferredReleasesBack: number
): { change: number | null; releasesSpanned: number } {
  if (rows.length > preferredReleasesBack) {
    const past = rows[preferredReleasesBack].actual;
    if (past !== null) {
      return { change: round((rows[0].actual as number) - past), releasesSpanned: preferredReleasesBack };
    }
  }
  if (rows.length > 1) {
    const availableBack = rows.length - 1;
    const past = rows[availableBack].actual;
    if (past !== null) {
      return { change: round((rows[0].actual as number) - past), releasesSpanned: availableBack };
    }
  }
  return { change: null, releasesSpanned: 0 };
}

function classifyVixLevel(vix: number): "Low volatility" | "Normal" | "Elevated risk aversion" | "High stress" {
  if (vix < VIX_LOW_THRESHOLD) return "Low volatility";
  if (vix < VIX_NORMAL_UPPER_THRESHOLD) return "Normal";
  if (vix < VIX_ELEVATED_UPPER_THRESHOLD) return "Elevated risk aversion";
  return "High stress";
}

const PREFERRED_TREND_SPAN = 3;

export function generateRiskEnvironmentAssessment(
  input: RiskEnvironmentEngineInput
): RiskEnvironmentAssessment {
  const asOf = new Date().toISOString();
  const facts: AssessmentFact[] = [];
  const calculations: AssessmentCalculation[] = [];
  const interpretations: AssessmentInterpretation[] = [];
  const evidence: string[] = [];
  const conflictingEvidence: string[] = [];
  const dataLimitations: string[] = [
    "VIX is currently the only integrated risk indicator.",
    "Equity-market conditions are not integrated.",
    "Credit spreads are not integrated.",
    "Broader cross-asset risk conditions are therefore incomplete — this assessment does not represent the full risk environment.",
  ];

  const real = realReleasesOnly(input.vix);

  // ================= FACT + missing-data handling =================
  if (real.length === 0) {
    dataLimitations.push("VIX (VIXCLS): no releases stored yet.");
    return {
      category: "Risk Environment",
      asOf,
      facts,
      calculations,
      interpretations,
      assessment: "Neutral",
      confidence: "Insufficient data",
      evidence,
      conflictingEvidence,
      dataLimitations,
    };
  }

  const latest = real[0];
  facts.push({
    label: "VIX (latest)",
    value: latest.actual,
    periodCovered: latest.period_covered,
    source: toSourceRef(latest),
  });

  // ================= CALCULATIONS =================
  const { change, releasesSpanned } = changeOverAvailableSpan(real, PREFERRED_TREND_SPAN);
  calculations.push({
    label: `VIX: change over last ${releasesSpanned || PREFERRED_TREND_SPAN} release(s)`,
    formula: `latest.actual - value_${releasesSpanned || PREFERRED_TREND_SPAN}_releases_ago`,
    result: change,
    unavailableReason: change === null ? `Need at least 2 stored releases; have ${real.length}.` : undefined,
  });

  const level = classifyVixLevel(latest.actual as number);
  calculations.push({
    label: "VIX level classification",
    formula: `<${VIX_LOW_THRESHOLD}=Low volatility, ${VIX_LOW_THRESHOLD}-${VIX_NORMAL_UPPER_THRESHOLD}=Normal, ${VIX_NORMAL_UPPER_THRESHOLD}-${VIX_ELEVATED_UPPER_THRESHOLD}=Elevated risk aversion, >${VIX_ELEVATED_UPPER_THRESHOLD}=High stress`,
    result: latest.actual,
  });

  // ================= INTERPRETATIONS =================
  interpretations.push({
    label: "VIX level classification",
    rule: `Market-convention bands (NOT official CBOE/Fed thresholds — widely used across trading-desk and financial-media commentary, kept as adjustable constants): <${VIX_LOW_THRESHOLD}=Low volatility, ${VIX_LOW_THRESHOLD}–${VIX_NORMAL_UPPER_THRESHOLD}=Normal, ${VIX_NORMAL_UPPER_THRESHOLD}–${VIX_ELEVATED_UPPER_THRESHOLD}=Elevated risk aversion, >${VIX_ELEVATED_UPPER_THRESHOLD}=High stress.`,
    result: level,
    isProvisionalThreshold: true,
  });
  evidence.push(`VIX = ${latest.actual} → ${level} (market-convention band, not an official threshold).`);

  const trendDirection = change === null ? "insufficient" : change > 0 ? "rising" : change < 0 ? "falling" : "flat";
  if (trendDirection !== "insufficient") {
    interpretations.push({
      label: "VIX trend",
      rule: "Mechanical reading of VIX's own recent change: rising, falling, or flat over the available span.",
      result: `VIX ${trendDirection}`,
    });
    evidence.push(`VIX ${trendDirection} over the last ${releasesSpanned} release(s) (${change! >= 0 ? "+" : ""}${change}).`);
  } else {
    dataLimitations.push("VIX trend unavailable: insufficient history.");
  }

  // ================= ASSESSMENT =================
  // Risk-On: VIX Low and/or falling. Risk-Off: VIX High/Elevated and/or
  // rising. Neutral: VIX in the Normal range with no clear directional
  // signal. No numeric score, no averaging — a direct rule read off the
  // level classification and trend direction only.
  let assessment: RiskEnvironmentAssessment["assessment"];
  let assessmentReason: string;

  const isLow = level === "Low volatility";
  const isElevatedOrStress = level === "Elevated risk aversion" || level === "High stress";
  const isFalling = trendDirection === "falling";
  const isRising = trendDirection === "rising";

  if (isLow || isFalling) {
    assessment = "Risk-On";
    assessmentReason = isLow && isFalling
      ? "VIX is both Low and falling."
      : isLow
      ? "VIX level reads Low volatility."
      : "VIX is falling.";
  } else if (isElevatedOrStress || isRising) {
    assessment = "Risk-Off";
    assessmentReason = isElevatedOrStress && isRising
      ? `VIX level reads ${level} and is rising.`
      : isElevatedOrStress
      ? `VIX level reads ${level}.`
      : "VIX is rising.";
  } else {
    assessment = "Neutral";
    assessmentReason = `VIX level reads Normal with no clear directional signal (trend: ${trendDirection}).`;
  }

  interpretations.push({
    label: "Overall Risk Environment assessment",
    rule: "Risk-On if VIX is Low and/or falling. Risk-Off if VIX is Elevated/High-stress and/or rising. Neutral if VIX is in the Normal range with no clear direction. No numeric score is computed and nothing is averaged. This does NOT claim VIX alone fully represents global risk sentiment — see data limitations.",
    result: `${assessment} — ${assessmentReason}`,
  });

  // ================= EXPLICIT NON-CONVERSION NOTE =================
  // This engine deliberately does NOT translate its Risk-On/Risk-Off
  // result into a USD bullish/bearish read. That conversion is not
  // performed here, and this assessment is not fed into the Overall USD
  // Fundamental Condition mechanically — see file header.
  evidence.push(
    "This assessment is contextual only. It is not automatically converted into a USD bullish/bearish read, and it is not mechanically included in the Overall USD Fundamental Condition — the USD's relationship with risk sentiment depends on relative monetary policy, global growth, liquidity, and capital flows, which are not modeled here."
  );

  // ================= CONFIDENCE =================
  // Capped at Low — VIX is the only risk indicator currently available.
  const confidence: ConfidenceLevel = "Low";

  return {
    category: "Risk Environment",
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
