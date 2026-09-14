/**
 * GET /api/assessment/usd
 *
 * Read-only USD assessment pipeline. Fetches the exact history depth required
 * by each deterministic category engine, then runs category assessments and
 * the overall USD orchestrator.
 */
import { NextResponse } from "next/server";
import { getIndicatorHistory } from "@/layers/historical-database/database";
import { generateInflationAssessment } from "@/layers/fundamental-scoring/inflation";
import { generateEmploymentAssessmentFromBls } from "@/layers/fundamental-scoring/employment-sahm-derived";
import { generateGrowthAssessment } from "@/layers/fundamental-scoring/growth";
import { generateMonetaryPolicyAssessment } from "@/layers/fundamental-scoring/monetary-policy";
import { generateMarketPricingAssessment } from "@/layers/fundamental-scoring/market-pricing";
import { generateRiskEnvironmentAssessment } from "@/layers/fundamental-scoring/risk-environment";
import { generateOverallUsdAssessment } from "@/layers/fundamental-scoring/orchestrator";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET() {
  try {
    const [
      cpi, coreCpi, pce, corePce, ppi,
      nfp, unemploymentRate, avgHourlyEarnings,
      initialJoblessClaims, continuingClaims, jolts,
      gdpGrowthRate, retailSales, industrialProduction,
      fedFundsRate, treasury2y, treasury10y, broadDollarIndex, vix,
    ] = await Promise.all([
      getIndicatorHistory("CPI", 13),
      getIndicatorHistory("CORE_CPI", 13),
      getIndicatorHistory("PCE", 13),
      getIndicatorHistory("CORE_PCE", 13),
      getIndicatorHistory("PPI", 13),
      getIndicatorHistory("NFP", 13),
      getIndicatorHistory("UNEMPLOYMENT_RATE", 15),
      getIndicatorHistory("AVG_HOURLY_EARNINGS", 13),
      getIndicatorHistory("INITIAL_JOBLESS_CLAIMS", 8),
      getIndicatorHistory("CONTINUING_CLAIMS", 4),
      getIndicatorHistory("JOLTS", 4),
      getIndicatorHistory("GDP_GROWTH_RATE", 8),
      getIndicatorHistory("RETAIL_SALES", 13),
      getIndicatorHistory("INDUSTRIAL_PRODUCTION", 13),
      getIndicatorHistory("FED_FUNDS_RATE", 4),
      getIndicatorHistory("TREASURY_2Y", 10),
      getIndicatorHistory("TREASURY_10Y", 10),
      getIndicatorHistory("BROAD_DOLLAR_INDEX", 4),
      getIndicatorHistory("VIX", 4),
    ]);

    const inflation = generateInflationAssessment({
      cpi: cpi ?? [], coreCpi: coreCpi ?? [], pce: pce ?? [], corePce: corePce ?? [], ppi: ppi ?? [],
    });

    const employment = generateEmploymentAssessmentFromBls({
      nfp: nfp ?? [],
      unemploymentRate: unemploymentRate ?? [],
      avgHourlyEarnings: avgHourlyEarnings ?? [],
      initialClaims: initialJoblessClaims ?? [],
      continuingClaims: continuingClaims ?? [],
      jolts: jolts ?? [],
      sahmRule: [],
    });

    const growth = generateGrowthAssessment({
      gdpGrowthRate: gdpGrowthRate ?? [],
      retailSales: retailSales ?? [],
      industrialProduction: industrialProduction ?? [],
    });

    const monetaryPolicy = generateMonetaryPolicyAssessment({
      fedFundsRate: fedFundsRate ?? [],
      inflationAssessment: inflation.assessment,
      employmentAssessment: employment.assessment,
      growthAssessment: growth.assessment,
    });

    const marketPricing = generateMarketPricingAssessment({
      treasury2y: treasury2y ?? [],
      treasury10y: treasury10y ?? [],
      usBroadDollarIndex: broadDollarIndex ?? [],
    });

    const riskEnvironment = generateRiskEnvironmentAssessment({
      vix: vix ?? [],
    });

    const overall = generateOverallUsdAssessment({
      inflation,
      employment,
      growth,
      monetaryPolicy,
      marketPricing,
      riskEnvironment,
    });

    return NextResponse.json(overall);
  } catch (err) {
    console.error("USD assessment generation failed:", err);
    return NextResponse.json(
      { error: "Could not generate the USD fundamental assessment. Check server logs." },
      { status: 500 }
    );
  }
}
