/**
 * LAYER 6 — ORCHESTRATOR: OVERALL USD FUNDAMENTAL CONDITION
 *
 * Combines the SIX ALREADY-COMPUTED category assessments (Inflation,
 * Employment, Growth, Monetary Policy, Market Pricing, Risk Environment)
 * into the Overall USD Fundamental Condition. Does NOT recalculate any
 * underlying category — it only reads their `.assessment`/`.confidence`
 * fields, exactly as each category engine already produced them.
 *
 * NOT an average of six scores. No weighted average, no bullish/bearish
 * point system, no AI decision, no arbitrary numeric score. Applies four
 * named, deterministic rules (see docs/methodology_fundamental_scoring.md,
 * Orchestration section) and, when none of them cleanly fit, falls back to
 * an explicit Neutral/Mixed result that lists exactly which categories
 * disagree — contradictions are surfaced, never hidden or resolved by
 * force.
 *
 * Risk Environment is read and reported as CONTEXT ONLY. It is never
 * mechanically converted into a USD bullish/bearish read and never feeds
 * the rule logic below.
 *
 * TERMINOLOGY GUARD: results are always framed as "Overall USD
 * Fundamental Condition" / "USD fundamental condition assessed as X" —
 * never as a prediction ("the USD will rise/fall") or an instruction
 * ("buy/sell USD"). This is an analytical assessment, not a trading signal.
 */

import type {
  UsdFundamentalAssessment,
  InflationAssessment,
  EmploymentAssessment,
  GrowthAssessment,
  MonetaryPolicyAssessment,
  MarketPricingAssessment,
  RiskEnvironmentAssessment,
  AssessmentCalculation,
  AssessmentInterpretation,
  ConfidenceLevel,
  StrengthLabel,
} from "@/types/assessment";

export interface OrchestratorInput {
  inflation: InflationAssessment;
  employment: EmploymentAssessment;
  growth: GrowthAssessment;
  monetaryPolicy: MonetaryPolicyAssessment;
  marketPricing: MarketPricingAssessment;
  riskEnvironment: RiskEnvironmentAssessment;
}

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  High: 0,
  Medium: 1,
  Low: 2,
  "Insufficient data": 3,
};

/** Returns the MOST CONSERVATIVE (weakest) confidence among the given levels — preserves transparency rather than overstating overall confidence. */
function weakestConfidence(levels: ConfidenceLevel[]): ConfidenceLevel {
  let weakest: ConfidenceLevel = "High";
  for (const level of levels) {
    if (CONFIDENCE_RANK[level] > CONFIDENCE_RANK[weakest]) weakest = level;
  }
  return weakest;
}

export function generateOverallUsdAssessment(
  input: OrchestratorInput
): UsdFundamentalAssessment {
  const asOf = new Date().toISOString();
  const calculations: AssessmentCalculation[] = [];
  const interpretations: AssessmentInterpretation[] = [];
  const evidence: string[] = [];
  const conflictingEvidence: string[] = [];
  const dataLimitations: string[] = [];

  const { inflation, employment, growth, monetaryPolicy, marketPricing, riskEnvironment } = input;

  // ================= CORE RULE: count Strong vs Weak among Inflation/Employment/Growth =================
  // This majority-count IS explicitly specified by the approved
  // methodology's own Rules 1-3 at THIS orchestration layer (unlike the
  // individual category engines, which deliberately avoid vote-counting
  // internally) — it is followed literally here because the spec itself
  // defines the rules this way.
  const threeCategories: Array<{ name: string; label: StrengthLabel }> = [
    { name: "Inflation", label: inflation.assessment },
    { name: "Employment", label: employment.assessment },
    { name: "Growth", label: growth.assessment },
  ];
  const strongCount = threeCategories.filter((c) => c.label === "Strong").length;
  const weakCount = threeCategories.filter((c) => c.label === "Weak").length;
  const moderateCount = threeCategories.filter((c) => c.label === "Moderate").length;

  calculations.push({
    label: "Strong count among Inflation/Employment/Growth",
    formula: "count(assessment === 'Strong') over {Inflation, Employment, Growth}",
    result: strongCount,
  });
  calculations.push({
    label: "Weak count among Inflation/Employment/Growth",
    formula: "count(assessment === 'Weak') over {Inflation, Employment, Growth}",
    result: weakCount,
  });
  calculations.push({
    label: "Moderate count among Inflation/Employment/Growth",
    formula: "count(assessment === 'Moderate') over {Inflation, Employment, Growth}",
    result: moderateCount,
  });

  const majorityStrong = strongCount >= 2;
  const majorityWeak = weakCount >= 2;

  interpretations.push({
    label: "Majority determination",
    rule: "Majority = 2 or more of Inflation/Employment/Growth sharing the same label (Strong or Weak). This 2-of-3 count is explicitly specified by the approved orchestration rules — not a general voting mechanism applied elsewhere in this system.",
    result: majorityStrong ? "Majority Strong" : majorityWeak ? "Majority Weak" : "No clear majority",
  });

  // ================= APPLY THE FOUR NAMED RULES, IN ORDER =================
  let overallCondition: UsdFundamentalAssessment["overallCondition"];
  let ruleApplied: string;

  if (majorityStrong && monetaryPolicy.assessment === "Hawkish" && marketPricing.assessment === "Hawkish") {
    // ---- RULE 1: Coherent Hawkish Case ----
    overallCondition = "Strong";
    ruleApplied = "Rule 1 — Coherent Hawkish Case";
    const supporting = threeCategories.filter((c) => c.label === "Strong").map((c) => c.name);
    evidence.push(
      `Coherent hawkish case: ${supporting.join(", ")} read Strong (${strongCount} of 3), Monetary Policy reads Hawkish, and Market Pricing reads Hawkish — all three legs agree.`
    );
  } else if (majorityStrong && marketPricing.assessment === "Dovish") {
    // ---- RULE 2: Fundamentals vs Market Pricing Contradiction ----
    overallCondition = "Moderate";
    ruleApplied = "Rule 2 — Fundamentals vs Market Pricing Contradiction";
    conflictingEvidence.push(
      "Fundamental data remains supportive, but market pricing is not confirming the macro picture."
    );
    evidence.push(
      `${strongCount} of Inflation/Employment/Growth read Strong, but Market Pricing reads Dovish — not forced into Strong or Dovish; reported as Moderate with the contradiction surfaced.`
    );
  } else if (majorityWeak && monetaryPolicy.assessment === "Dovish" && marketPricing.assessment === "Dovish") {
    // ---- RULE 3: Coherent Dovish Case ----
    overallCondition = "Weak";
    ruleApplied = "Rule 3 — Coherent Dovish Case";
    const supporting = threeCategories.filter((c) => c.label === "Weak").map((c) => c.name);
    evidence.push(
      `Coherent dovish case: ${supporting.join(", ")} read Weak (${weakCount} of 3), Monetary Policy reads Dovish, and Market Pricing reads Dovish — all three legs agree.`
    );
  } else {
    // ---- RULE 4: Split / Mixed Case (default) ----
    overallCondition = "Neutral";
    ruleApplied = "Rule 4 — Split/Mixed Case";

    if (!majorityStrong && !majorityWeak) {
      conflictingEvidence.push(
        `No clear majority among Inflation (${inflation.assessment}), Employment (${employment.assessment}), Growth (${growth.assessment}) — Strong: ${strongCount}, Weak: ${weakCount}, Moderate: ${moderateCount}.`
      );
    }
    if (majorityStrong && monetaryPolicy.assessment !== "Hawkish") {
      conflictingEvidence.push(
        `Fundamentals show a Strong majority among Inflation/Employment/Growth, but Monetary Policy reads ${monetaryPolicy.assessment} (not Hawkish) — not automatically calling USD Strong; this disagreement is surfaced rather than resolved.`
      );
    }
    if (majorityWeak && monetaryPolicy.assessment !== "Dovish") {
      conflictingEvidence.push(
        `Fundamentals show a Weak majority among Inflation/Employment/Growth, but Monetary Policy reads ${monetaryPolicy.assessment} (not Dovish) — not automatically calling USD Weak; this disagreement is surfaced rather than resolved.`
      );
    }
    if (majorityStrong && monetaryPolicy.assessment === "Hawkish" && marketPricing.assessment !== "Hawkish" && marketPricing.assessment !== "Dovish") {
      conflictingEvidence.push(
        `Fundamentals and Monetary Policy both read Hawkish/Strong, but Market Pricing reads ${marketPricing.assessment} rather than confirming Hawkish — surfaced rather than resolved into Strong.`
      );
    }
    if (majorityWeak && monetaryPolicy.assessment === "Dovish" && marketPricing.assessment !== "Dovish") {
      conflictingEvidence.push(
        `Fundamentals and Monetary Policy both read Dovish/Weak, but Market Pricing reads ${marketPricing.assessment} rather than confirming Dovish — surfaced rather than resolved into Weak.`
      );
    }
  }

  // ================= INDEPENDENT CHECK: Monetary Policy vs Market Pricing disagreement =================
  // Always checked, regardless of which rule above fired.
  if (monetaryPolicy.assessment !== marketPricing.assessment) {
    conflictingEvidence.push(
      `Monetary Policy (${monetaryPolicy.assessment}) and Market Pricing (${marketPricing.assessment}) provide different signals — surfaced explicitly rather than reconciled.`
    );
  }

  interpretations.push({
    label: "Overall USD Fundamental Condition — decision rule applied",
    rule: "Rule 1 (Coherent Hawkish): majority Strong + Monetary Policy Hawkish + Market Pricing Hawkish → Strong. Rule 2 (Fundamentals vs Pricing Contradiction): majority Strong + Market Pricing Dovish → Moderate. Rule 3 (Coherent Dovish): majority Weak + Monetary Policy Dovish + Market Pricing Dovish → Weak. Rule 4 (Split/Mixed, default): everything else → Neutral, with every disagreement listed individually. This is NOT an average of six scores and involves no weighted point system.",
    result: `${overallCondition} (${ruleApplied})`,
  });

  const rationale = `USD fundamental condition assessed as ${overallCondition} via ${ruleApplied}. Inflation=${inflation.assessment}, Employment=${employment.assessment}, Growth=${growth.assessment} (Strong: ${strongCount}, Weak: ${weakCount}, Moderate: ${moderateCount}); Monetary Policy=${monetaryPolicy.assessment}; Market Pricing=${marketPricing.assessment}.`;

  // ================= RISK ENVIRONMENT: CONTEXT ONLY — never folded into the rule logic above =================
  evidence.push(
    `Risk Environment context (not scored into the Overall USD Condition): ${riskEnvironment.assessment} (confidence: ${riskEnvironment.confidence}). The USD's relationship with risk sentiment depends on relative monetary policy, global growth, liquidity, and capital flows, which are not modeled here — Risk-Off is NOT automatically converted to USD Bullish, and Risk-On is NOT automatically converted to USD Bearish.`
  );

  // ================= CONFIDENCE: the weakest (most conservative) among the five scored categories =================
  // Risk Environment's confidence is excluded — it is contextual only and
  // does not participate in the Overall USD Condition.
  const scoredConfidences: ConfidenceLevel[] = [
    inflation.confidence,
    employment.confidence,
    growth.confidence,
    monetaryPolicy.confidence,
    marketPricing.confidence,
  ];
  const confidence = weakestConfidence(scoredConfidences);

  const categoryConfidenceNotes = [
    { name: "Inflation", confidence: inflation.confidence },
    { name: "Employment", confidence: employment.confidence },
    { name: "Growth", confidence: growth.confidence },
    { name: "Monetary Policy", confidence: monetaryPolicy.confidence },
    { name: "Market Pricing", confidence: marketPricing.confidence },
  ].filter((c) => c.confidence !== "High");

  if (categoryConfidenceNotes.length > 0) {
    dataLimitations.push(
      `Overall confidence is capped by the weakest underlying category: ${categoryConfidenceNotes
        .map((c) => `${c.name}=${c.confidence}`)
        .join(", ")}. See each category's own data limitations for full detail.`
    );
  }
  dataLimitations.push(
    "Risk Environment is reported as context only and is excluded from both the Overall USD Condition rule logic and the confidence calculation above — see its own assessment for its (separately capped) confidence and limitations."
  );

  return {
    asOf,
    overallCondition,
    categories: {
      inflation,
      employment,
      growth,
      monetaryPolicy,
      marketPricing,
      riskEnvironment,
    },
    facts: [], // no new raw facts at this layer — see type doc comment in assessment.ts
    calculations,
    interpretations,
    confidence,
    evidence,
    conflictingEvidence,
    dataLimitations,
    rationale,
  };
}
