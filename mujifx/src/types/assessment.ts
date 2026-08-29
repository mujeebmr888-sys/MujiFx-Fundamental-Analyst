/**
 * SHARED ASSESSMENT SCHEMA
 * Used by every category engine (Inflation, Employment, Growth, Monetary
 * Policy, Market Pricing, Risk Environment) and by the orchestrator that
 * combines them into the Overall USD Fundamental Condition.
 *
 * This file defines STRUCTURE ONLY — no calculations, no thresholds, no
 * category logic live here. See docs/methodology_fundamental_scoring.md
 * for the approved methodology each category engine must implement
 * against this schema.
 *
 * Every assessment preserves the full chain:
 *   FACT → CALCULATION → INTERPRETATION → ASSESSMENT → CONFIDENCE →
 *   EVIDENCE → CONFLICTING EVIDENCE → DATA LIMITATIONS
 * so nothing is collapsed into a single opaque string, and every
 * assessment is traceable back to the specific data and rule that
 * produced it.
 */

import type { DataSourceRef, IndicatorId } from "./economic-data";

/** A raw, retrieved number — no interpretation applied yet. */
export interface AssessmentFact {
  label: string; // e.g. "Fed Funds Rate"
  indicator?: IndicatorId;
  value: number | string | null;
  unit?: string;
  periodCovered?: string;
  source: DataSourceRef;
}

/** A derived number, with its formula shown so it's independently checkable. */
export interface AssessmentCalculation {
  label: string; // e.g. "3-month annualized momentum"
  formula: string; // human-readable, e.g. "((latest/value_3mo_ago)^(12/3) - 1) * 100"
  result: number | null;
  /** Set explicitly when a calculation could not be performed (e.g. not enough history) rather than silently returning null. */
  unavailableReason?: string;
}

/**
 * A calculation mapped to a label via an explicit, fixed rule — the rule
 * text itself is shown so nothing is a hidden black box.
 */
export interface AssessmentInterpretation {
  label: string; // e.g. "Distance from target"
  rule: string; // the actual threshold/logic applied, in plain words
  result: string; // e.g. "Elevated", "Rate trend: rising"
  /** Marks thresholds that are provisional/configurable design choices rather than economic facts (e.g. the ±0.5pp inflation band). */
  isProvisionalThreshold?: boolean;
}

export type ConfidenceLevel = "High" | "Medium" | "Low" | "Insufficient data";

/** Per-category assessment labels — deliberately different per category, never a generic bullish/bearish score. */
export type StrengthLabel = "Strong" | "Moderate" | "Weak";
export type PolicyStanceLabel = "Hawkish" | "Neutral" | "Dovish";
export type RiskLabel = "Risk-On" | "Neutral" | "Risk-Off";
export type OverallConditionLabel = "Strong" | "Moderate" | "Neutral" | "Weak";

export type CategoryName =
  | "Inflation"
  | "Employment"
  | "Growth"
  | "Monetary Policy"
  | "Market Pricing"
  | "Risk Environment";

/**
 * The full structured output of ONE category engine. Generic over the
 * label type since categories use different vocabularies (Strong/Moderate/
 * Weak vs Hawkish/Neutral/Dovish vs Risk-On/Neutral/Risk-Off).
 */
export interface CategoryAssessment<TLabel extends string> {
  category: CategoryName;
  asOf: string; // ISO timestamp this assessment was generated

  facts: AssessmentFact[];
  calculations: AssessmentCalculation[];
  interpretations: AssessmentInterpretation[];

  assessment: TLabel;
  confidence: ConfidenceLevel;

  /** Which specific facts/calculations supported the final assessment label. */
  evidence: string[];
  /** Anything that pointed the other way — never silently dropped. */
  conflictingEvidence: string[];
  /** What we don't have yet, stated plainly rather than guessed at. */
  dataLimitations: string[];
}

export type InflationAssessment = CategoryAssessment<StrengthLabel>;
export type EmploymentAssessment = CategoryAssessment<StrengthLabel>;
export type GrowthAssessment = CategoryAssessment<StrengthLabel>;
export type MonetaryPolicyAssessment = CategoryAssessment<PolicyStanceLabel>;
export type MarketPricingAssessment = CategoryAssessment<PolicyStanceLabel>;
export type RiskEnvironmentAssessment = CategoryAssessment<RiskLabel>;

/**
 * The orchestrator's output — combines all six category assessments into
 * the Overall USD Fundamental Condition WITHOUT averaging scores. Explicitly
 * preserves cross-category relationships and contradictions rather than
 * collapsing them into one number. Risk Environment is included for
 * context but does not drive the overall condition (see methodology doc,
 * Section 6, for why).
 */
export interface UsdFundamentalAssessment {
  asOf: string;
  overallCondition: OverallConditionLabel;

  categories: {
    inflation: InflationAssessment;
    employment: EmploymentAssessment;
    growth: GrowthAssessment;
    monetaryPolicy: MonetaryPolicyAssessment;
    marketPricing: MarketPricingAssessment;
    riskEnvironment: RiskEnvironmentAssessment; // contextual only, not scored into overallCondition
  };

  /** Which rule-table branch was applied (see methodology doc, Orchestration section), stated in plain words. */
  rationale: string;

  /** Cross-category contradictions surfaced explicitly, e.g. "Fundamental data remains supportive, but market pricing is not confirming the macro picture." */
  contradictions: string[];
}
