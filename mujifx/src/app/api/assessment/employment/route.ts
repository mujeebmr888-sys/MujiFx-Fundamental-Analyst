/**
 * GET /api/assessment/employment
 *
 * Read-only Employment category assessment endpoint.
 * Uses authoritative stored histories and derives the Sahm stress input
 * directly from BLS unemployment history.
 */
import { NextResponse } from "next/server";
import { getIndicatorHistory } from "@/layers/historical-database/database";
import { generateEmploymentAssessmentFromBls } from "@/layers/fundamental-scoring/employment-sahm-derived";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET() {
  try {
    const [
      nfp,
      unemploymentRate,
      avgHourlyEarnings,
      initialClaims,
      continuingClaims,
      jolts,
      sahmRule,
    ] = await Promise.all([
      getIndicatorHistory("NFP", 13),
      getIndicatorHistory("UNEMPLOYMENT_RATE", 15),
      getIndicatorHistory("AVG_HOURLY_EARNINGS", 13),
      getIndicatorHistory("INITIAL_JOBLESS_CLAIMS", 8),
      getIndicatorHistory("CONTINUING_CLAIMS", 4),
      getIndicatorHistory("JOLTS", 4),
      getIndicatorHistory("SAHM_RULE", 1),
    ]);

    const assessment = generateEmploymentAssessmentFromBls({
      nfp: nfp ?? [],
      unemploymentRate: unemploymentRate ?? [],
      avgHourlyEarnings: avgHourlyEarnings ?? [],
      initialClaims: initialClaims ?? [],
      continuingClaims: continuingClaims ?? [],
      jolts: jolts ?? [],
      sahmRule: sahmRule ?? [],
    });

    return NextResponse.json(assessment);
  } catch (err) {
    console.error("Employment assessment generation failed:", err);
    return NextResponse.json(
      { error: "Could not generate the Employment assessment. Check server logs." },
      { status: 500 }
    );
  }
}
