/**
 * Core data contract for every economic data point in the system.
 * Every layer (acquisition, normalization, database, scoring, AI reasoning)
 * reads and writes THIS shape. Never invent fields on the fly elsewhere.
 */

export type IndicatorId =
  | "CPI"
  | "CORE_CPI"
  | "PCE"
  | "CORE_PCE"
  | "PPI"
  | "NFP"
  | "UNEMPLOYMENT_RATE"
  | "AVG_HOURLY_EARNINGS"
  | "INITIAL_JOBLESS_CLAIMS"
  | "CONTINUING_CLAIMS"
  | "JOLTS"
  | "GDP"
  | "RETAIL_SALES"
  | "INDUSTRIAL_PRODUCTION"
  | "ISM_MANUFACTURING"
  | "ISM_SERVICES"
  | "FED_FUNDS_RATE"
  | "TREASURY_2Y"
  | "TREASURY_10Y"
  | "BROAD_DOLLAR_INDEX";

export type SourceTier = "TIER_1_OFFICIAL" | "TIER_2_NEWS" | "TIER_3_RESEARCH";

export interface DataSourceRef {
  name: string; // e.g. "FRED (BLS series CPIAUCSL)"
  url: string;
  tier: SourceTier;
  retrievedAt: string; // ISO timestamp
}

/**
 * A single economic data release, normalized.
 * If a value is unavailable, DO NOT set it to 0 or null silently —
 * set `available: false` and explain why in `unavailableReason`.
 */
export interface EconomicDataPoint {
  indicator: IndicatorId;
  releaseDate: string; // ISO date of the actual release
  periodCovered: string; // e.g. "2026-07" for July data

  previous: number | null;
  consensusForecast: number | null; // market/analyst consensus
  mujifxEstimate: number | null; // our own model estimate, if produced
  actual: number | null;

  unit: string; // e.g. "%", "index", "thousands of jobs"
  available: boolean;
  unavailableReason?: string; // required if available === false

  source: DataSourceRef;
}

export interface DerivedMetrics {
  indicator: IndicatorId;
  releaseDate: string;
  surprise: number | null; // actual - consensusForecast
  surprisePct: number | null;
  momChange: number | null;
  yoyChange: number | null;
  trendDirection: "up" | "down" | "flat" | "unknown";
}

export interface FundamentalScore {
  currency: "USD";
  asOf: string;
  overallBias: "bullish" | "bearish" | "neutral" | "mixed";
  score: number; // weighted composite, e.g. -10 to +10
  breakdown: Array<{
    indicator: IndicatorId;
    contribution: number;
    weight: number;
    rationale: string;
  }>;
}

/**
 * Output of the AI analyst reasoning layer.
 * This is research commentary — it must never contain trade instructions.
 */
export interface AnalystAssessment {
  currency: "USD";
  generatedAt: string;
  whatChanged: string;
  whyItChanged: string;
  economicImplications: string;
  centralBankImplications: string;
  marketExpectationsVsPricing: string;
  crossAssetConfirmation: string;
  contradictions: string;
  risks: string;
  finalAssessment: string;
  sourcesUsed: DataSourceRef[];
  disclaimer: string; // always populated, never omitted
}
