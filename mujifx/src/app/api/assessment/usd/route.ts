/**
 * GET /api/assessment/usd
 *
 * Wires the six approved Layer 6 category engines and the orchestrator
 * into the server-side pipeline:
 *
 *   fetch required histories → Inflation → Employment → Growth →
 *   Monetary Policy → Market Pricing → Risk Environment →
 *   Overall USD Assessment → JSON response
 *
 * READ-ONLY. Fetches existing rows from `economic_data_points` via the
 * already-existing `getIndicatorHistory()` function — no new Supabase
 * table, no migration, nothing is written or persisted by this route.
 *
 * Does NOT touch /api/sync/all, page.tsx, scoring.ts, or any category
 * engine — this is a new, independent route so the old single-score
 * system keeps working completely unaffected.
 *
 * HISTORY DEPTH PER INDICATOR — deliberately NOT a blanket "limit=13"
 * assumption. Each limit below is the exact minimum this project's own
 * engines need, verified by inspecting their calculation code (max array
 * index referenced, or any `.length` threshold the engine checks for its
 * own confidence logic):
 *
 *   Inflation (5, monthly cadence — CPI/PCE/PPI):
 *     CPI, CORE_CPI, PCE, CORE_PCE, PPI → 13
 *       (YoY calculation reads index 12; confidence logic also checks
 *        `.length >= 13`, so fewer rows would permanently under-report
 *        confidence even once enough real data exists)
 *
 *   Employment (7, mixed cadence):
 *     NFP, UNEMPLOYMENT_RATE, AVG_HOURLY_EARNINGS → 13
 *       (12-month pace / YoY calculations read index 12)
 *     INITIAL_JOBLESS_CLAIMS → 8
 *       (weekly series; compares current 4-week avg to the PRIOR 4-week
 *        avg, i.e. weeks 5-8 back — reads index 7)
 *     CONTINUING_CLAIMS, JOLTS → 4
 *       (3-release trend as primary signal — reads index 3)
 *     SAHM_RULE → 1
 *       (used only as a latest-value stress flag; no historical trend is
 *        computed for it in the Employment engine)
 *
 *   Growth (3, mixed cadence):
 *     GDP_GROWTH_RATE → 8
 *       (the calculation itself only reads index 0 — GDP is a quarterly,
 *        already-published growth rate used as-is — but the engine's own
 *        confidence logic checks `.length < 2`; requesting only 1 row
 *        would make that check permanently see "1" even once multiple
 *        real quarters exist, since `limit` caps what's fetched. 8 rows
 *        ≈ 2 years of quarterly data, giving that check room to work.)
 *     RETAIL_SALES, INDUSTRIAL_PRODUCTION → 13
 *       (3/6/12-release trend calculations read up to index 12)
 *
 *   Monetary Policy (1, monthly cadence):
 *     FED_FUNDS_RATE → 4
 *       (change-over-last-3-releases reads index 3, with graceful
 *        fallback to fewer)
 *
 *   Market Pricing (3, daily-ish cadence):
 *     TREASURY_2Y, TREASURY_10Y → 10
 *       (trend calculation itself only needs index 3, but the 10Y-2Y
 *        spread TREND is computed by aligning the two series on their
 *        observation date (`period_covered`) rather than array index —
 *        daily series can have non-overlapping business-day gaps, so a
 *        larger buffer meaningfully improves the odds of finding enough
 *        genuinely common aligned dates; this fetches more REAL rows,
 *        never invented ones)
 *     BROAD_DOLLAR_INDEX → 4
 *       (no alignment matching involved for this one — plain trend only)
 *
 *   Risk Environment (1, daily cadence):
 *     VIX → 4
 *       (trend calculation reads index 3)
 *
 *   Total indicators: 5 + 7 + 3 + 1 + 3 + 1 = 20
 */

import { NextResponse } from "next/server";
import { getIndicatorHistory } from "@/layers/historical-database/database";
import { generateInflationAssessment } from "@/layers/fundamental-scoring/inflation";
import { generateEmploymentAssessment } from "@/layers/fundamental-scoring/employment";
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
    // ---- Fetch required histories (read-only, existing table, existing function) ----
    const [
      cpi,
      coreCpi,
      pce,
      corePce,
      ppi,
      nfp,
      unemploymentRate,
      avgHourlyEarnings,
      initialJoblessClaims,
      continuingClaims,
      jolts,
      sahmRule,
      gdpGrowthRate,
      retailSales,
      industrialProduction,
      fedFundsRate,
      treasury2y,
      treasury10y,
      broadDollarIndex,
      vix,
    ] = await Promise.all([
      getIndicatorHistory("CPI", 13),
      getIndicatorHistory("CORE_CPI", 13),
      getIndicatorHistory("PCE", 13),
      getIndicatorHistory("CORE_PCE", 13),
      getIndicatorHistory("PPI", 13),
      getIndicatorHistory("NFP", 13),
      getIndicatorHistory("UNEMPLOYMENT_RATE", 13),
      getIndicatorHistory("AVG_HOURLY_EARNINGS", 13),
      getIndicatorHistory("INITIAL_JOBLESS_CLAIMS", 8),
      getIndicatorHistory("CONTINUING_CLAIMS", 4),
      getIndicatorHistory("JOLTS", 4),
      getIndicatorHistory("SAHM_RULE", 1),
      getIndicatorHistory("GDP_GROWTH_RATE", 8),
      getIndicatorHistory("RETAIL_SALES", 13),
      getIndicatorHistory("INDUSTRIAL_PRODUCTION", 13),
      getIndicatorHistory("FED_FUNDS_RATE", 4),
      getIndicatorHistory("TREASURY_2Y", 10),
      getIndicatorHistory("TREASURY_10Y", 10),
      getIndicatorHistory("BROAD_DOLLAR_INDEX", 4),
      getIndicatorHistory("VIX", 4),
    ]);

    // ---- Layer 6: run each category engine on its own already-fetched history ----
    const inflation = generateInflationAssessment({
      cpi: cpi ?? [],
      coreCpi: coreCpi ?? [],
      pce: pce ?? [],
      corePce: corePce ?? [],
      ppi: ppi ?? [],
    });

    const employment = generateEmploymentAssessment({
      nfp: nfp ?? [],
      unemploymentRate: unemploymentRate ?? [],
      avgHourlyEarnings: avgHourlyEarnings ?? [],
      initialClaims: initialJoblessClaims ?? [],
      continuingClaims: continuingClaims ?? [],
      jolts: jolts ?? [],
      sahmRule: sahmRule ?? [],
    });

    const growth = generateGrowthAssessment({
      gdpGrowthRate: gdpGrowthRate ?? [],
      retailSales: retailSales ?? [],
      industrialProduction: industrialProduction ?? [],
    });

    // Monetary Policy reads the ALREADY-COMPUTED Inflation/Employment/Growth
    // `.assessment` labels — it does not recalculate those categories.
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

    // ---- Orchestrator: combines the six ALREADY-COMPUTED assessments — never recalculates them ----
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
