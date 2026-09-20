import { NextResponse, type NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/cron-auth";
import {
  BLS_PPI_SERIES_ID,
  blsPpiPeriodToMonth,
  fetchBlsPpi,
} from "@/layers/data-acquisition/sources/bls-ppi";
import {
  BLS_JOLTS_SERIES_ID,
  blsJoltsPeriodToMonth,
  fetchBlsJolts,
} from "@/layers/data-acquisition/sources/bls-jolts";
import { writeAuthoritativeBatch } from "@/layers/data-acquisition/authoritative-writer";
import type { AuthoritativeObservation } from "@/layers/data-acquisition/authoritative-writer";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // This route writes to the database and consumes an upstream API quota.
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const endYear = new Date().getUTCFullYear();
  const startYear = endYear - 1;

  try {
    // Fetch sequentially so a failing source is unambiguous in logs/errors and
    // one slow BLS request cannot mask the other source's result.
    const ppi = await fetchBlsPpi(startYear, endYear);
    const jolts = await fetchBlsJolts(startYear, endYear);

    const observations: AuthoritativeObservation[] = [];

    for (const item of [...ppi.observations].sort((a, b) =>
      blsPpiPeriodToMonth(a.year, a.period).localeCompare(blsPpiPeriodToMonth(b.year, b.period))
    )) {
      observations.push({
        indicator: "PPI",
        periodCovered: blsPpiPeriodToMonth(item.year, item.period),
        actual: item.value,
        unit: "Index",
        sourceName: "U.S. Bureau of Labor Statistics (BLS)",
        sourceUrl: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
        sourceTier: "TIER_1_OFFICIAL",
        sourceObservationId: `${BLS_PPI_SERIES_ID}:${item.year}:${item.period}`,
        sourceReleaseDate: null,
        sourceReleaseDateVerified: false,
        retrievedAt: ppi.retrievedAt,
      });
    }

    for (const item of [...jolts.observations].sort((a, b) =>
      blsJoltsPeriodToMonth(a.year, a.period).localeCompare(blsJoltsPeriodToMonth(b.year, b.period))
    )) {
      observations.push({
        indicator: "JOLTS",
        periodCovered: blsJoltsPeriodToMonth(item.year, item.period),
        actual: item.value,
        unit: "Thousands of job openings",
        sourceName: "U.S. Bureau of Labor Statistics (BLS)",
        sourceUrl: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
        sourceTier: "TIER_1_OFFICIAL",
        sourceObservationId: `${BLS_JOLTS_SERIES_ID}:${item.year}:${item.period}`,
        sourceReleaseDate: null,
        sourceReleaseDateVerified: false,
        retrievedAt: jolts.retrievedAt,
      });
    }

    const results = await writeAuthoritativeBatch(
      "U.S. Bureau of Labor Statistics (BLS)",
      observations
    );

    return NextResponse.json({
      success: true,
      source: "BLS",
      range: { startYear, endYear },
      series: {
        PPI: BLS_PPI_SERIES_ID,
        JOLTS: BLS_JOLTS_SERIES_ID,
      },
      rowsSeen: observations.length,
      rowsWritten: results.reduce((sum, item) => sum + item.rowsWritten, 0),
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Authoritative BLS P1 sync failed:", message);

    return NextResponse.json(
      {
        success: false,
        stage: "authoritative-bls-p1-ingestion",
        range: { startYear, endYear },
        reason: "Could not complete the authoritative BLS P1 sync.",
        error: message,
      },
      { status: 500 }
    );
  }
}
