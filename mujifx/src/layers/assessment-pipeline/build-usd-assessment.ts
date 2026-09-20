/**
 * ASSESSMENT PIPELINE
 *
 * ONE place that reads the exact history depth each deterministic category
 * engine requires, runs all six engines, and runs the orchestrator.
 *
 * Previously this wiring lived inline inside /api/assessment/usd only,
 * which meant (a) no page could render the real engine output, and (b) the
 * per-category endpoints each re-derived their own, slightly different
 * fetch depths. Both routes and pages now call this, so the depths can
 * never drift apart.
 *
 * REQUIRED HISTORY DEPTHS - these are not arbitrary. Each is the minimum
 * the corresponding engine's own calculations need; shortening one silently
 * downgrades that category's confidence to "Insufficient data".
 *   13 months  -> 12 month-over-month changes / a YoY comparison
 *   15 months  -> the Sahm Rule (current 3-mo avg vs the min of the
 *                previous twelve 3-mo averages)
 *    8 weeks   -> 4-week moving averages of jobless claims, plus a prior
 *                4-week window to compare against
 *    8 quarters-> two years of GDP prints
 */

import { getIndicatorHistory } from "@/layers/historical-database/database";
import { generateInflationAssessment } from "@/layers/fundamental-scoring/inflation";
import { generateEmploymentAssessmentFromBls } from "@/layers/fundamental-scoring/employment-sahm-derived";
import { generateGrowthAssessment } from "@/layers/fundamental-scoring/growth";
import { generateMonetaryPolicyAssessment } from "@/layers/fundamental-scoring/monetary-policy";
import { generateMarketPricingAssessment } from "@/layers/fundamental-scoring/market-pricing";
import { generateRiskEnvironmentAssessment } from "@/layers/fundamental-scoring/risk-environment";
import { generateOverallUsdAssessment } from "@/layers/fundamental-scoring/orchestrator";
import type { UsdFundamentalAssessment } from "@/types/assessment";
import type { IndicatorId } from "@/types/economic-data";

/** Single source of truth for how deep each engine needs to read. */
export const ASSESSMENT_HISTORY_DEPTH: Record<string, number> = {
  CPI: 13,
  CORE_CPI: 13,
  PCE: 13,
  CORE_PCE: 13,
  PPI: 13,
  NFP: 13,
  UNEMPLOYMENT_RATE: 15,
  AVG_HOURLY_EARNINGS: 13,
  INITIAL_JOBLESS_CLAIMS: 8,
  CONTINUING_CLAIMS: 4,
  JOLTS: 4,
  GDP_GROWTH_RATE: 8,
  RETAIL_SALES: 13,
  INDUSTRIAL_PRODUCTION: 13,
  FED_FUNDS_RATE: 4,
  // Small depth is enough -- this only needs to detect "did the most
  // recent value change from the one before it", not a trend.
  FED_TARGET_RANGE_UPPER: 5,
  TREASURY_2Y: 10,
  TREASURY_10Y: 10,
  BROAD_DOLLAR_INDEX: 4,
  VIX: 4,
};

const REQUIRED_INDICATORS = Object.keys(ASSESSMENT_HISTORY_DEPTH) as IndicatorId[];

type HistoryMap = Record<string, any[]>;

/**
 * Reads every required history in parallel.
 *
 * A single indicator failing to read must not take down the whole
 * assessment - the engines are all built to degrade honestly to
 * "Insufficient data" when an input is empty, and that is a far more
 * useful outcome than a 500. Failed reads are returned in `readErrors` so
 * the page can surface them instead of hiding a silent empty array.
 */
async function loadHistories(): Promise<{ histories: HistoryMap; readErrors: string[] }> {
  const readErrors: string[] = [];

  const settled = await Promise.all(
    REQUIRED_INDICATORS.map(async (indicator) => {
      try {
        const rows = await getIndicatorHistory(indicator, ASSESSMENT_HISTORY_DEPTH[indicator]);
        return [indicator, rows ?? []] as const;
      } catch (err) {
        readErrors.push(
          `${indicator}: ${err instanceof Error ? err.message : String(err)}`
        );
        return [indicator, []] as const;
      }
    })
  );

  return { histories: Object.fromEntries(settled), readErrors };
}

export interface UsdAssessmentResult {
  assessment: UsdFundamentalAssessment;
  /** Indicators whose database read failed - empty on a healthy run. */
  readErrors: string[];
}

export async function buildUsdAssessment(): Promise<UsdAssessmentResult> {
  const { histories: h, readErrors } = await loadHistories();

  const inflation = generateInflationAssessment({
    cpi: h.CPI,
    coreCpi: h.CORE_CPI,
    pce: h.PCE,
    corePce: h.CORE_PCE,
    ppi: h.PPI,
  });

  const employment = generateEmploymentAssessmentFromBls({
    nfp: h.NFP,
    unemploymentRate: h.UNEMPLOYMENT_RATE,
    avgHourlyEarnings: h.AVG_HOURLY_EARNINGS,
    initialClaims: h.INITIAL_JOBLESS_CLAIMS,
    continuingClaims: h.CONTINUING_CLAIMS,
    jolts: h.JOLTS,
    // Deliberately empty: generateEmploymentAssessmentFromBls derives the
    // Sahm value from the stored BLS unemployment history and overwrites
    // whatever is passed here. Passing a fetched SAHM_RULE series would be
    // dead weight that looks like a real input.
    sahmRule: [],
  });

  const growth = generateGrowthAssessment({
    gdpGrowthRate: h.GDP_GROWTH_RATE,
    retailSales: h.RETAIL_SALES,
    industrialProduction: h.INDUSTRIAL_PRODUCTION,
  });

  const monetaryPolicy = generateMonetaryPolicyAssessment({
    fedFundsRate: h.FED_FUNDS_RATE,
    fedTargetRangeUpper: h.FED_TARGET_RANGE_UPPER,
    inflationAssessment: inflation.assessment,
    employmentAssessment: employment.assessment,
    growthAssessment: growth.assessment,
  });

  const marketPricing = generateMarketPricingAssessment({
    treasury2y: h.TREASURY_2Y,
    treasury10y: h.TREASURY_10Y,
    usBroadDollarIndex: h.BROAD_DOLLAR_INDEX,
  });

  const riskEnvironment = generateRiskEnvironmentAssessment({ vix: h.VIX });

  const assessment = generateOverallUsdAssessment({
    inflation,
    employment,
    growth,
    monetaryPolicy,
    marketPricing,
    riskEnvironment,
  });

  return { assessment, readErrors };
}
