import { NextResponse, type NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/cron-auth";
import { FED_G17_IP_SERIES_ID, fetchFedG17IndustrialProduction } from "@/layers/data-acquisition/sources/fed-g17-ip";
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
    const ip = await fetchFedG17IndustrialProduction(startYear, endYear);

    const observations: AuthoritativeObservation[] = ip.observations.map((item) => ({
      indicator: "INDUSTRIAL_PRODUCTION",
      periodCovered: item.period,
      actual: item.value,
      unit: "Index (2017=100)",
      sourceName: "Board of Governors of the Federal Reserve System (G.17)",
      sourceUrl: "https://www.federalreserve.gov/releases/g17/",
      sourceTier: "TIER_1_OFFICIAL",
      sourceObservationId: `${FED_G17_IP_SERIES_ID}:${item.period}`,
      sourceReleaseDate: null,
      sourceReleaseDateVerified: false,
      retrievedAt: ip.retrievedAt,
    }));

    const results = await writeAuthoritativeBatch(
      "Board of Governors of the Federal Reserve System (G.17)",
      observations
    );

    return NextResponse.json({
      success: true,
      source: "Federal Reserve G.17",
      range: { startYear, endYear },
      series: { INDUSTRIAL_PRODUCTION: FED_G17_IP_SERIES_ID },
      rowsSeen: observations.length,
      rowsWritten: results.reduce((sum, item) => sum + item.rowsWritten, 0),
      results,
    });
  } catch (error) {
    console.error("Authoritative Federal Reserve G.17 IP sync failed:", error);
    return NextResponse.json(
      {
        success: false,
        stage: "authoritative-fed-g17-ip-ingestion",
        reason: "Could not complete the authoritative Federal Reserve G.17 IP sync. Check server logs.",
      },
      { status: 500 }
    );
  }
}
