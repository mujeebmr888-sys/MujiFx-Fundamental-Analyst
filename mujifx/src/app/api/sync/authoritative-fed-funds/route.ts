/**
 * STEP 13M - AUTHORITATIVE FED FUNDS INGESTION
 *
 * Server-side ingestion route for the Federal Reserve Board H.15 monthly
 * effective federal funds rate. This is the effective rate, not the FOMC
 * target range.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/cron-auth";
import {
  FED_FUNDS_H15_SERIES_ID,
  fetchFedFundsPilot,
} from "@/layers/data-acquisition/sources/fed-funds";
import { writeAuthoritativeBatch } from "@/layers/data-acquisition/authoritative-writer";
import type { AuthoritativeObservation } from "@/layers/data-acquisition/authoritative-writer";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // This route writes to the database and consumes an upstream API quota.
  const denied = requireCronSecret(request);
  if (denied) return denied;

  try {
    const result = await fetchFedFundsPilot();

    const sorted = [...result.observations].sort((a, b) =>
      a.period.localeCompare(b.period)
    );

    const observations: AuthoritativeObservation[] = sorted.map(
      (observation, index) => ({
        indicator: "FED_FUNDS_RATE",
        periodCovered: observation.period,
        actual: observation.value,
        unit: "Percent per year",
        sourceName: "Federal Reserve Board (H.15)",
        sourceUrl: "https://www.federalreserve.gov/datadownload/Preview.aspx",
        sourceTier: "TIER_1_OFFICIAL",
        sourceObservationId: `H15:${FED_FUNDS_H15_SERIES_ID}:${observation.period}`,
        sourceReleaseDate: null,
        sourceReleaseDateVerified: false,
        retrievedAt: result.retrievedAt,
        previous: index > 0 ? sorted[index - 1].value : null,
      })
    );

    const results = await writeAuthoritativeBatch(
      "Federal Reserve Board (H.15)",
      observations
    );

    return NextResponse.json({
      success: true,
      source: "Federal Reserve Board",
      series: FED_FUNDS_H15_SERIES_ID,
      rowsSeen: observations.length,
      rowsWritten: results.reduce((sum, item) => sum + item.rowsWritten, 0),
      results,
    });
  } catch (error) {
    console.error("Authoritative Fed Funds sync failed:", error);
    return NextResponse.json(
      {
        success: false,
        stage: "authoritative-fed-funds-ingestion",
        reason: "Could not complete the authoritative Fed Funds sync. Check server logs.",
      },
      { status: 500 }
    );
  }
}
