/**
 * LAYER 6 — MONETARY POLICY ASSESSMENT ENGINE
 *
 * Implements the Monetary Policy section of
 * docs/methodology_fundamental_scoring.md and the Step 5 specification.
 * Deterministic only — no AI, no invented indicators, no new data sources.
 * Pure function: takes already-fetched Fed Funds Rate history plus the
 * ALREADY-COMPUTED Inflation/Employment/Growth assessments as input.
 *
 * CORE PRINCIPLE: this engine does NOT claim to know the Fed's communicated
 * intent. FOMC statement text, minutes, the dot plot, speeches, forward
 * guidance, and communication tone are NOT ingested — every output is
 * explicitly framed as an assessment from the rate direction and
 * economic-data pressure.
 */

import type {
  MonetaryPolicyAssessment,
  AssessmentFact,
  AssessmentCalculation,
  AssessmentInterpretation,
  ConfidenceLevel,
  StrengthLabel,
} from "@/types/assessment";
import type { DataSourceRef } from "@/types/economic-data";

export interface MonetaryPolicyHistoryRow {
  actual: number | null;
  previous: number | null;
  period_covered: string;
  release_date: string;
  source_name: string;
  source_url: string;
  source_tier: string;
  retrieved_at: string;
}

export interface MonetaryPolicyEngineInput {
  fedFundsRate: MonetaryPolicyHistoryRow[];
  inflationAssessment: StrengthLabel;
  employmentAssessment: StrengthLabel;
  growthAssessment: StrengthLabel;
}

function toSourceRef(row: MonetaryPolicyHistoryRow): DataSourceRef {
  return {
    name: row.source_name,
    url: row.source_url,
    tier: row.source_tier as DataSourceRef["tier"],
    retrievedAt: row.retrieved_at,
  };
}

function realReleasesOnly(rows: MonetaryPolicyHistoryRow[]): MonetaryPolicyHistoryRow[] {
  return rows.filter((r) => r.actual !== null);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function generateMonetaryPolicyAssessment(
  input: MonetaryPolicyEngineInput
): MonetaryPolicyAssessment {
  const asOf = new Date().toISOString();
  const facts: AssessmentFact[] = [];
  const calculations: AssessmentCalculation[] = [];
  const interpretations: AssessmentInterpretation[] = [];
  const evidence: string[] = [];
  const conflictingEvidence: string[] = [];
  const dataLimitations: string[] = [
    "FOMC statement text is not ingested.",
    "FOMC minutes are not ingested.",
    "The dot plot is not ingested.",
    "Fed speeches are not ingested.",
    "Forward guidance is not ingested.",
    "Communication tone is not ingested.",
    "Because of the above, this engine cannot assess the Fed's communicated intent — only what the policy rate and economic data show.",
  ];

  const real = realReleasesOnly(input.fedFundsRate);

  if (real.length === 0) {
    dataLimitations.push("Fed Funds Rate: no releases stored yet.");
    return {
      category: "Monetary Policy",
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
    label: "Fed Funds Rate (current)",
    value: latest.actual,
    periodCovered: latest.period_covered,
    source: toSourceRef(latest),
  });

  if (latest.previous !== null) {
    facts.push({
      label: "Fed Funds Rate (previous release)",
      value: latest.previous,
      source: toSourceRef(latest),
    });
  }

  const RELEASES_BACK = 3;
  let changeOverN: number | null = null;
  let releasesSpanned = 0;

  if (real.length > RELEASES_BACK) {
    const past = real[RELEASES_BACK].actual;
    if (past !== null) {
      changeOverN = round((latest.actual as number) - past);
      releasesSpanned = RELEASES_BACK;
    }
  } else if (real.length > 1) {
    const availableBack = real.length - 1;
    const past = real[availableBack].actual;
    if (past !== null) {
      changeOverN = round((latest.actual as number) - past);
      releasesSpanned = availableBack;
    }
  }

  calculations.push({
    label: `Fed Funds Rate: change over last ${releasesSpanned || RELEASES_BACK} release(s)`,
    formula: `latest.actual - value_${releasesSpanned || RELEASES_BACK}_releases_ago`,
    result: changeOverN,
    unavailableReason:
      changeOverN === null ? `Need at least 2 stored releases; have ${real.length}.` : undefined,
  });

  if (changeOverN !== null) {
    evidence.push(
      `Fed Funds Rate: ${latest.actual}% currently, ${changeOverN >= 0 ? "+" : ""}${changeOverN}pp over the last ${releasesSpanned} release(s) (FACT only — no Hawkish/Dovish label attached at this stage).`
    );
  }

  let rateTrend: "rising" | "falling" | "flat" | "insufficient" = "insufficient";
  if (changeOverN !== null) {
    rateTrend = changeOverN > 0 ? "rising" : changeOverN < 0 ? "falling" : "flat";
    interpretations.push({
      label: "Rate-only directional read",
      rule: "Mechanical reading of the policy rate's own recent change only: rising if positive, falling if negative, flat if unchanged. This is NOT the Fed's stance.",
      result: `Rate trend: ${rateTrend}`,
    });
  } else {
    dataLimitations.push("Rate-only directional read unavailable: insufficient Fed Funds Rate history.");
  }

  const { inflationAssessment, employmentAssessment, growthAssessment } = input;

  let dataImpliedPressure: "Hawkish" | "Dovish" | "Neutral/Mixed";
  if (inflationAssessment === "Strong" && (employmentAssessment === "Strong" || growthAssessment === "Strong")) {
    dataImpliedPressure = "Hawkish";
  } else if (inflationAssessment === "Weak" && (employmentAssessment === "Weak" || growthAssessment === "Weak")) {
    dataImpliedPressure = "Dovish";
  } else {
    dataImpliedPressure = "Neutral/Mixed";
  }

  interpretations.push({
    label: "Data-implied policy pressure",
    rule: "Hawkish if Inflation=Strong AND (Employment=Strong OR Growth=Strong). Dovish if Inflation=Weak AND (Employment=Weak OR Growth=Weak). Neutral/Mixed otherwise. No weighted average, numeric score, or majority vote.",
    result: dataImpliedPressure,
  });
  evidence.push(
    `Data-implied policy pressure = ${dataImpliedPressure} (from Inflation=${inflationAssessment}, Employment=${employmentAssessment}, Growth=${growthAssessment}).`
  );

  let assessment: MonetaryPolicyAssessment["assessment"];
  let assessmentReason: string;

  if (rateTrend === "insufficient") {
    assessment = "Neutral";
    assessmentReason = "Rate-only directional read is unavailable (insufficient Fed Funds Rate history), so the broader policy assessment defaults to Neutral pending more data.";
  } else if (rateTrend === "rising" && dataImpliedPressure === "Hawkish") {
    assessment = "Hawkish";
    assessmentReason = "Rate trend rising AND data-implied pressure Hawkish — the rate direction and economic-data pressure agree.";
  } else if (rateTrend === "falling" && dataImpliedPressure === "Dovish") {
    assessment = "Dovish";
    assessmentReason = "Rate trend falling AND data-implied pressure Dovish — the rate direction and economic-data pressure agree.";
  } else if (rateTrend === "rising" && dataImpliedPressure === "Dovish") {
    assessment = "Neutral";
    assessmentReason = "Rate trend rising but data-implied pressure Dovish — policy and economic-data signals diverge, so the mismatch is not resolved into Hawkish or Dovish.";
    conflictingEvidence.push(
      `Policy-data divergence: the Fed Funds Rate is rising, but the underlying economic data implies Dovish pressure (Inflation=${inflationAssessment}, Employment=${employmentAssessment}, Growth=${growthAssessment}).`
    );
  } else if (rateTrend === "falling" && dataImpliedPressure === "Hawkish") {
    assessment = "Neutral";
    assessmentReason = "Rate trend falling but data-implied pressure Hawkish — policy and economic-data signals diverge, so the mismatch is not resolved into Hawkish or Dovish.";
    conflictingEvidence.push(
      `Policy-data divergence: the Fed Funds Rate is falling, but the underlying economic data implies Hawkish pressure (Inflation=${inflationAssessment}, Employment=${employmentAssessment}, Growth=${growthAssessment}).`
    );
  } else if (rateTrend === "flat" && dataImpliedPressure !== "Neutral/Mixed") {
    assessment = "Neutral";
    assessmentReason = `Rate trend flat while data-implied pressure is ${dataImpliedPressure}. The approved methodology does not define a separate policy-rate level threshold for establishing a flat-but-elevated or flat-but-easing stance, so the engine does not invent one.`;
    dataLimitations.push(
      "Flat policy-rate interpretation is conservative: no approved numeric threshold currently defines when a flat rate should be treated as elevated or easing."
    );
  } else {
    assessment = "Neutral";
    assessmentReason = `Rate trend ${rateTrend} combined with ${dataImpliedPressure} data-implied pressure does not match a Hawkish or Dovish combination.`;
  }

  interpretations.push({
    label: "Broader policy assessment (Step 4)",
    rule: "Combines the rate-only directional read with data-implied policy pressure. Rising+Hawkish → Hawkish; falling+Dovish → Dovish; rising+Dovish or falling+Hawkish → Neutral with explicit divergence. A flat rate is not assigned Hawkish/Dovish without an approved rate-level threshold; Neutral/Mixed pressure remains Neutral.",
    result: `${assessment} — ${assessmentReason}`,
  });

  evidence.push(
    assessment === "Hawkish" || assessment === "Dovish"
      ? `Policy stance assessed as ${assessment} based on policy-rate direction and economic-data pressure. The Fed's communicated stance cannot be assessed because FOMC communication data is not currently ingested.`
      : "Policy stance assessed as Neutral/Mixed based on policy-rate direction and economic-data pressure. The Fed's communicated stance cannot be assessed because FOMC communication data is not currently ingested."
  );

  let confidence: ConfidenceLevel;
  const categoryInputsAvailable =
    inflationAssessment !== undefined && employmentAssessment !== undefined && growthAssessment !== undefined;

  if (rateTrend === "insufficient") {
    confidence = "Insufficient data";
  } else if (!categoryInputsAvailable) {
    confidence = "Low";
    dataLimitations.push("One or more of Inflation/Employment/Growth assessments were not available — confidence capped at Low.");
  } else {
    confidence = "Medium";
  }

  return {
    category: "Monetary Policy",
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
