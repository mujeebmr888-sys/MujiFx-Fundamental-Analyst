import { NextResponse, type NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/cron-auth";
import {
  DOL_UI_CLAIMS_URL,
  fetchDolUiClaims,
} from "@/layers/data-acquisition/sources/dol-ui-claims";
import { writeAuthoritativeBatch } from "@/layers/data-acquisition/authoritative-writer";
import type { AuthoritativeObservation } from "@/layers/data-acquisition/authoritative-writer";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // This route writes to the database and consumes an upstream API quota.
  const denied = requireCronSecret(request);
  if (denied) return denied;

  try {
    const endYear = new Date().getUTCFullYear();
    const startYear = endYear - 1;
    const claims = await fetchDolUiClaims(startYear, endYear);

    const observations: AuthoritativeObservation[] = [];

    for (const item of claims.observations) {
      observations.push({
        indicator: "INITIAL_JOBLESS_CLAIMS",
        periodCovered: item.weekEnded,
        actual: item.initialClaims,
        unit: "Claims",
        sourceName: "U.S. Department of Labor (Employment and Training Administration)",
        sourceUrl: DOL_UI_CLAIMS_URL,
        sourceTier: "TIER_1_OFFICIAL",
        sourceObservationId: `INITIAL:${item.weekEnded}`,
        sourceReleaseDate: null,
        sourceReleaseDateVerified: false,
        retrievedAt: claims.retrievedAt,
      });

      if (item.reflectingWeekEnded) {
        observations.push({
          indicator: "CONTINUING_CLAIMS",
          periodCovered: item.reflectingWeekEnded,
          actual: item.continuedClaims,
          unit: "Claims",
          sourceName: "U.S. Department of Labor (Employment and Training Administration)",
          sourceUrl: DOL_UI_CLAIMS_URL,
          sourceTier: "TIER_1_OFFICIAL",
          sourceObservationId: `CONTINUING:${item.reflectingWeekEnded}`,
          sourceReleaseDate: null,
          sourceReleaseDateVerified: false,
          retrievedAt: claims.retrievedAt,
        });
      }
    }

    const results = await writeAuthoritativeBatch(
      "U.S. Department of Labor (Employment and Training Administration)",
      observations
    );

    return NextResponse.json({
      success: true,
      source: "U.S. Department of Labor (Employment and Training Administration)",
      range: { startYear, endYear },
      sourceUrl: DOL_UI_CLAIMS_URL,
      rowsSeen: observations.length,
      rowsWritten: results.reduce((sum, item) => sum + item.rowsWritten, 0),
      results,
    });
  } catch (error) {
    console.error("Authoritative DOL UI claims sync failed:", error);
    return NextResponse.json(
      {
        success: false,
        stage: "authoritative-dol-ui-claims-ingestion",
        reason: "Could not complete the authoritative DOL UI claims sync. Check server logs.",
      },
      { status: 500 }
    );
  }
}
