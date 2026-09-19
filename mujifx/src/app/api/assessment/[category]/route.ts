/**
 * GET /api/assessment/[category]
 *
 * Read-only endpoint for ONE category assessment:
 *   inflation | employment | growth | monetary-policy | market-pricing |
 *   risk-environment
 *
 * These were previously missing (only `usd` and `employment` existed), so
 * four of the six engines had no way to be inspected individually. Each
 * category is computed by the same shared pipeline that produces the
 * overall condition, so a category read here is guaranteed identical to
 * the one folded into /api/assessment/usd.
 */
import { NextResponse } from "next/server";
import { buildUsdAssessment } from "@/layers/assessment-pipeline/build-usd-assessment";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const CATEGORY_KEYS = {
  inflation: "inflation",
  employment: "employment",
  growth: "growth",
  "monetary-policy": "monetaryPolicy",
  "market-pricing": "marketPricing",
  "risk-environment": "riskEnvironment",
} as const;

type CategorySlug = keyof typeof CATEGORY_KEYS;

export async function GET(
  _request: Request,
  { params }: { params: { category: string } }
) {
  const slug = params.category as CategorySlug;
  const key = CATEGORY_KEYS[slug];

  if (!key) {
    return NextResponse.json(
      {
        error: `Unknown category "${params.category}".`,
        validCategories: Object.keys(CATEGORY_KEYS),
      },
      { status: 404 }
    );
  }

  try {
    const { assessment, readErrors } = await buildUsdAssessment();
    return NextResponse.json({ ...assessment.categories[key], readErrors });
  } catch (err) {
    console.error(`${params.category} assessment generation failed:`, err);
    return NextResponse.json(
      { error: `Could not generate the ${params.category} assessment. Check server logs.` },
      { status: 500 }
    );
  }
}
