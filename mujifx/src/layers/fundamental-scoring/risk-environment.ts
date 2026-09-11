/**
 * LAYER 6 — RISK ENVIRONMENT ASSESSMENT ENGINE
 *
 * Deterministic VIX-only contextual assessment. Risk Environment is NOT a
 * USD directional category and is NOT mechanically included in the Overall
 * USD Fundamental Condition.
 */

import type {
  RiskEnvironmentAssessment,
  AssessmentFact,
  AssessmentCalculation,
  AssessmentInterpretation,
  ConfidenceLevel,
} from "@/types/assessment";
import type { DataSourceRef } from "@/types/economic-data";

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

/** Market-convention bands, explicitly provisional rather than official thresholds. */
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

function realObservationsOnly(rows: RiskEnvironmentHistoryRow[]): RiskEnvironmentHistoryRow[] {
  return rows.filter((r) => r.actual !== null);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Compare the latest observation with an earlier available observation; never invent missing history. */
function changeOverAvailableSpan(
  rows: RiskEnvironmentHistoryRow[],
  preferredObservationsBack: number
): { change: number | null; observationsSpanned: number } {
  if (rows.length > preferredObservationsBack) {
    const past = rows[preferredObservationsBack].actual;
    if (past !== null) {
      return {
        change: round((rows[0].actual as number) - past),
        observationsSpanned: preferredObservationsBack,
      };
    }
  }
  if (rows.length > 1) {
    const availableBack = rows.length - 1;
    const past = rows[availableBack].actual;
    if (past !== null) {
      return {
        change: round((rows[0].actual as number) - past),
        observationsSpanned: availableBack,
      };
    }
  }
  return { change: null, observationsSpanned: 0 };
}

function classifyVixLevel(
  vix: number
): "Low volatility" | "Normal" | "Elevated risk aversion" | "High stress" {
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

  const real = realObservationsOnly(input.vix);

  if (real.length === 0) {
    dataLimitations.push("VIX (VIXCLS): no observations stored yet.");
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

  const { change, observationsSpanned } = changeOverAvailableSpan(real, PREFERRED_TREND_SPAN);
  calculations.push({
    label: `VIX: change over last ${observationsSpanned || PREFERRED_TREND_SPAN} observation(s)`,
    formula: `latest.actual - value_${observationsSpanned || PREFERRED_TREND_SPAN}_observations_ago`,
    result: change,
    unavailableReason:
      change === null ? `Need at least 2 stored observations; have ${real.length}.` : undefined,
  });

  const level = classifyVixLevel(latest.actual as number);
  calculations.push({
    label: "VIX level classification",
    formula: `<${VIX_LOW_THRESHOLD}=Low volatility, ${VIX_LOW_THRESHOLD}-${VIX_NORMAL_UPPER_THRESHOLD}=Normal, ${VIX_NORMAL_UPPER_THRESHOLD}-${VIX_ELEVATED_UPPER_THRESHOLD}=Elevated risk aversion, >${VIX_ELEVATED_UPPER_THRESHOLD}=High stress`,
    result: latest.actual,
  });

  interpretations.push({
    label: "VIX level classification",
    rule: `Market-convention bands (NOT official CBOE/Fed thresholds): <${VIX_LOW_THRESHOLD}=Low volatility, ${VIX_LOW_THRESHOLD}–${VIX_NORMAL_UPPER_THRESHOLD}=Normal, ${VIX_NORMAL_UPPER_THRESHOLD}–${VIX_ELEVATED_UPPER_THRESHOLD}=Elevated risk aversion, >${VIX_ELEVATED_UPPER_THRESHOLD}=High stress. These bands are provisional and adjustable.`,
    result: level,
    isProvisionalThreshold: true,
  });
  evidence.push(`VIX = ${latest.actual} → ${level} (provisional market-convention band, not an official threshold).`);

  const trendDirection = change === null ? "insufficient" : change > 0 ? "rising" : change < 0 ? "falling" : "flat";
  if (trendDirection !== "insufficient") {
    interpretations.push({
      label: "VIX trend",
      rule: "Mechanical reading of VIX's own recent change: rising, falling, or flat over the available observation span.",
      result: `VIX ${trendDirection}`,
    });
    evidence.push(`VIX ${trendDirection} over the last ${observationsSpanned} observation(s) (${change! >= 0 ? "+" : ""}${change}).`);
  } else {
    dataLimitations.push("VIX trend unavailable: insufficient history.");
  }

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
    rule: "Risk-On if VIX is Low and/or falling. Risk-Off if VIX is Elevated/High-stress and/or rising. Neutral if VIX is in the Normal range with no clear direction. No numeric score is computed and nothing is averaged. This is a contextual VIX-only read, not a complete global risk-sentiment model.",
    result: `${assessment} — ${assessmentReason}`,
  });

  evidence.push(
    "Risk Environment is contextual only. It is not automatically converted into a USD bullish/bearish read and is not mechanically included in the Overall USD Fundamental Condition."
  );

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
