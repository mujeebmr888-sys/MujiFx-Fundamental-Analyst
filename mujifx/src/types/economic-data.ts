/**
 * Core data contract for every economic data point in the system.
 * Every layer (acquisition, normalization, database, scoring, AI reasoning)
 * reads and writes THIS shape.
 *
 * IMPORTANT:
 * releaseDate can be null when the authoritative source has not supplied
 * or verified the actual publication/release date.
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
  | "SAHM_RULE"
  | "GDP"
  | "GDP_GROWTH_RATE"
  | "RETAIL_SALES"
  | "INDUSTRIAL_PRODUCTION"
  | "ISM_MANUFACTURING"
  | "ISM_SERVICES"
  | "FED_FUNDS_RATE"
  | "TREASURY_2Y"
  | "TREASURY_10Y"
  | "BROAD_DOLLAR_INDEX"
  | "VIX";

export type SourceTier =
  | "TIER_1_OFFICIAL"
  | "TIER_2_NEWS"
  | "TIER_3_RESEARCH";

export interface DataSourceRef {
  name: string;
  url: string;
  tier: SourceTier;
  retrievedAt: string;
}

/**
 * A single economic data release, normalized.
 *
 * releaseDate:
 * - actual official release/publication date when verified
 * - null when the source has not supplied/verified it
 *
 * Never use observation date as a fake release date.
 */
export interface EconomicDataPoint {
  indicator: IndicatorId;

  /**
   * Actual publication/release date.
   * Nullable because not every authoritative adapter currently
   * provides verified release metadata.
   */
  releaseDate: string | null;

  /**
   * Period the observation belongs to.
   * Example: 2026-07
   */
  periodCovered: string;

  previous: number | null;

  consensusForecast: number | null;

  mujifxEstimate: number | null;

  actual: number | null;

  unit: string;

  available: boolean;

  unavailableReason?: string;

  source: DataSourceRef;
}

export interface DerivedMetrics {
  indicator: IndicatorId;

  /**
   * Release date may be unknown until authoritative release metadata
   * is verified.
   */
  releaseDate: string | null;

  surprise: number | null;

  surprisePct: number | null;

  momChange: number | null;

  yoyChange: number | null;

  trendDirection:
    | "up"
    | "down"
    | "flat"
    | "unknown";
}

export interface FundamentalScore {
  currency: "USD";

  asOf: string;

  overallBias:
    | "bullish"
    | "bearish"
    | "neutral"
    | "mixed";

  score: number;

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

  /**
   * Always populated.
   */
  disclaimer: string;
}
