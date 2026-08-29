/**
 * LAYER 6 — MONETARY POLICY ASSESSMENT ENGINE
 *
 * Implements the Monetary Policy section of
 * docs/methodology_fundamental_scoring.md and the Step 5 specification
 * EXACTLY. Deterministic only — no AI, no invented indicators, no new data
 * sources. Pure function: takes already-fetched Fed Funds Rate history plus
 * the ALREADY-COMPUTED Inflation/Employment/Growth assessments as input
 * (does NOT recalculate those categories — it only reads their `.assessment`
 * field). Same architectural pattern as inflation.ts/employment.ts/growth.ts.
 *
 * CORE PRINCIPLE: this engine does NOT claim to know the Fed's communicated
 * intent. FOMC statement text, minutes, the dot plot, speeches, forward
 * guidance, and communication tone are NOT ingested — every output is
 * explicitly framed as "policy stance assessed FROM the rate direction and
 * economic-data pressure," never as "the Fed is Hawkish."
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

/** Minimal shape this engine needs from a stored release row (newest-first arrays, matching getIndicatorHistory's ordering). */
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
  /** Read-only inputs — this engine does NOT recalculate these categories, it only reads their `.assessment` label. */
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

/** Only real releases — defensively excludes forecast placeholder rows (actual: null) that can share this table. */
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

  // ================= STEP 1: POLICY RATE FACTS =================
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

  // Change over the last N releases, and how many releases that span covers — reported as plain facts, no label attached here.
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
    // Not enough for a full 3-release span — report over whatever span is actually available rather than inventing missing history.
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

  // ================= STEP 2: RATE-ONLY DIRECTIONAL READ =================
  // Purely mechanical — never called "Hawkish"/"Dovish"/"the Fed's stance" on its own.
  let rateTrend: "rising" | "falling" | "flat" | "insufficient" = "insufficient";
  if (changeOverN !== null) {
    rateTrend = changeOverN > 0 ? "rising" : changeOverN < 0 ? "falling" : "flat";
    interpretations.push({
      label: "Rate-only directional read",
      rule: "Mechanical reading of the policy rate's own recent change only: rising if positive, falling if negative, flat if unchanged. This is NOT the Fed's stance — it is the rate direction alone, Step 3 below is what cross-references economic data.",
      result: `Rate trend: ${rateTrend}`,
    });
  } else {
    dataLimitations.push("Rate-only directional read unavailable: insufficient Fed Funds Rate history.");
  }

  // ================= STEP 3: DATA-IMPLIED POLICY PRESSURE =================
  // Cross-references the ALREADY-COMPUTED Inflation/Employment/Growth
  // assessments (not recalculated here). Explicit deterministic rules only
  // — no weighted average, no numeric score, no majority voting.
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
    rule: "Deterministic rule, reading the ALREADY-COMPUTED Inflation/Employment/Growth category assessments (not recalculated here): Hawkish if Inflation=Strong AND (Employment=Strong OR Growth=Strong). Dovish if Inflation=Weak AND (Employment=Weak OR Growth=Weak). Neutral/Mixed otherwise. No weighted average, numeric score, or majority vote is used.",
    result: dataImpliedPressure,
  });
  evidence.push(
    `Data-implied policy pressure = ${dataImpliedPressure} (from Inflation=${inflationAssessment}, Employment=${employmentAssessment}, Growth=${growthAssessment}).`
  );

  // ================= STEP 4: BROADER POLICY ASSESSMENT =================
  // Combines Step 2 (rate-only read) with Step 3 (data-implied pressure).
  // Disagreement is never hidden — an explicit CONFLICTING_EVIDENCE entry
  // is created whenever the rate direction and the data-implied pressure
  // point different ways.
  let assessment: MonetaryPolicyAssessment["assessment"];
  let assessmentReason: string;

  if (rateTrend === "insufficient") {
    assessment = "Neutral";
    assessmentReason = "Rate-only directional read is unavailable (insufficient Fed Funds Rate history), so the broader policy assessment defaults to Neutral pending more data.";
  } else if (rateTrend === "rising" && dataImpliedPressure === "Hawkish") {
    assessment = "Hawkish";
    assessmentReason = "Rate trend rising AND data-implied pressure Hawkish — the rate direction and the economic-data pressure agree.";
  } else if (rateTrend === "falling" && dataImpliedPressure === "Dovish") {
    assessment = "Dovish";
    assessmentReason = "Rate trend falling AND data-implied pressure Dovish — the rate direction and the economic-data pressure agree.";
  } else if (rateTrend === "flat" && dataImpliedPressure === "Hawkish") {
    assessment = "Hawkish";
    assessmentReason = "Rate trend flat AND data-implied pressure Hawkish — read as a hawkish-hold / restrictive-pressure combination.";
  } else if (rateTrend === "flat" && dataImpliedPressure === "Dovish") {
    assessment = "Dovish";
    assessmentReason = "Rate trend flat AND data-implied pressure Dovish — read as a dovish-leaning / easing-pressure combination.";
  } else if (rateTrend === "rising" && dataImpliedPressure === "Dovish") {
    assessment = "Neutral";
    assessmentReason = "Rate trend rising but data-implied pressure Dovish — this is a policy-data divergence, not resolved into Hawkish or Dovish.";
    conflictingEvidence.push(
      `Policy-data divergence: the Fed Funds Rate has been rising (rate trend: rising), but the underlying economic data implies Dovish pressure (Inflation=${inflationAssessment}, Employment=${employmentAssessment}, Growth=${growthAssessment}) — these point in different directions and the mismatch is surfaced rather than resolved.`
    );
  } else if (rateTrend === "falling" && dataImpliedPressure === "Hawkish") {
    assessment = "Neutral";
    assessmentReason = "Rate trend falling but data-implied pressure Hawkish — this is a policy-data divergence, not resolved into Hawkish or Dovish.";
    conflictingEvidence.push(
      `Policy-data divergence: the Fed Funds Rate has been falling (rate trend: falling), but the underlying economic data implies Hawkish pressure (Inflation=${inflationAssessment}, Employment=${employmentAssessment}, Growth=${growthAssessment}) — these point in different directions and the mismatch is surfaced rather than resolved.`
    );
  } else {
    // flat + Neutral/Mixed, or rising/falling + Neutral/Mixed
    assessment = "Neutral";
    assessmentReason = `Rate trend ${rateTrend} combined with ${dataImpliedPressure} data-implied pressure does not match a Hawkish or Dovish combination.`;
  }

  interpretations.push({
    label: "Broader policy assessment (Step 4)",
    rule: "Combines the Step 2 rate-only directional read with the Step 3 data-implied policy pressure per a fixed combination table (rising+Hawkish→Hawkish; falling+Dovish→Dovish; flat+Hawkish→Hawkish-hold; flat+Dovish→Dovish-leaning; rising+Dovish or falling+Hawkish→Neutral with an explicit divergence flagged; anything + Neutral/Mixed→Neutral). This is the ONLY step where a Hawkish/Dovish/Neutral label is assigned — Steps 1-2 never assign one.",
    result: `${assessment} — ${assessmentReason}`,
  });

  // ================= TERMINOLOGY GUARD =================
  // This engine's output must always be read as an assessment DERIVED from
  // rate + data, never as a claim about the Fed's communicated intent.
  const disclaimer =
    assessment === "Hawkish" || assessment === "Dovish"
      ? `Policy stance assessed as ${assessment} based on the policy-rate direction and current economic-data pressure. The Fed's communicated stance cannot be assessed because FOMC communication data is not currently ingested.`
      : `Policy stance assessed as Neutral/Mixed based on the policy-rate direction and current economic-data pressure. The Fed's communicated stance cannot be assessed because FOMC communication data is not currently ingested.`;
  evidence.push(disclaimer);

  // ================= CONFIDENCE =================
  // Explicitly capped at Medium — FOMC communication data is never
  // ingested by this engine, so High confidence is never allowed.
  let confidence: ConfidenceLevel;
  const categoryInputsAvailable =
    inflationAssessment !== undefined && employmentAssessment !== undefined && growthAssessment !== undefined;

  if (rateTrend === "insufficient") {
    confidence = "Insufficient data";
  } else if (!categoryInputsAvailable) {
    confidence = "Low";
    dataLimitations.push("One or more of Inflation/Employment/Growth assessments were not available — confidence capped at Low.");
  } else {
    confidence = "Medium"; // hard cap — never High, per the core principle above
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
