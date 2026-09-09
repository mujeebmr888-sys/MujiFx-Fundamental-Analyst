/**
 * STEP 13K — AUTHORITATIVE CPI INGESTION
 *
 * Manual server-side verification route for the BLS CPI + Core CPI source
 * adapters and the shared authoritative writer.
 *
 * Scope is intentionally limited to the two CPI indicators. It does not
 * replace the legacy /api/sync/cpi route, change scoring, or fabricate release
 * dates. BLS API observations provide observation periods; release metadata
 * is therefore left unverified unless a later source contract establishes it.
 */

import { NextResponse } from "next/server";
import {
  fetchBlsCpiPilot,
  blsPeriodToMonth,
} from "@/layers/data-acquisition/sources/bls-cpi";
import {
  fetchBlsCoreCpiPilot,
  BLS_CORE_CPI_SERIES_ID,
} from "@/layers/data-acquisition/sources/bls-core-cpi";
import { writeAuthoritativeBatch } from "@/layers/data-acquisition/authoritative-writer";
import type { AuthoritativeObservation } from "@/layers/data-acquisition/authoritative-writer";

export const dynamic = "force-dynamic";

function toObservations(
  indicator: "CPI" | "CORE_CPI",
  seriesId: string,
  observations: Array<{
    year: string;
    period: string;
    value: number;
  }>,
  retrievedAt: string
): AuthoritativeObservation[] {
  const sorted = [...observations].sort((a, b) => {
    const aPeriod = blsPeriodToMonth(a.year, a.period);
    const bPeriod = blsPeriodToMonth(b.year, b.period);
    return aPeriod.localeCompare(bPeriod);
  });

  return sorted.map((observation, index) => ({
    indicator,
    periodCovered: blsPeriodToMonth(observation.year, observation.period),
    actual: observation.value,
    unit: "Index 1982-84=100",
    sourceName: "U.S. Bureau of Labor Statistics (BLS)",
    sourceUrl: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
    sourceTier: "TIER_1_OFFICIAL",
    sourceObservationId: `${seriesId}:${observation.year}:${observation.period}`,
    sourceReleaseDate: null,
    sourceReleaseDateVerified: false,
    retrievedAt,
    previous: index > 0 ? sorted[index - 1].value : null,
  }));
}

export async function GET() {
  try {
    const endYear = new Date().getUTCFullYear();
    const startYear = endYear - 1;

    const [cpi, coreCpi] = await Promise.all([
      fetchBlsCpiPilot(startYear, endYear),
      fetchBlsCoreCpiPilot(startYear, endYear),
    ]);

    const observations = [
      ...toObservations(
        "CPI",
        cpi.seriesId,
        cpi.observations,
        cpi.retrievedAt
      ),
      ...toObservations(
        "CORE_CPI",
        BLS_CORE_CPI_SERIES_ID,
        coreCpi.observations,
        coreCpi.retrievedAt
      ),
    ];

    const results = await writeAuthoritativeBatch(
      "U.S. Bureau of Labor Statistics (BLS)",
      observations
    );

    return NextResponse.json({
      success: true,
      source: "BLS",
      range: { startYear, endYear },
      rowsSeen: observations.length,
      rowsWritten: results.reduce((sum, result) => sum + result.rowsWritten, 0),
      results,
    });
  } catch (error) {
    console.error("Authoritative CPI sync failed:", error);

    return NextResponse.json(
      {
        success: false,
        stage: "authoritative-cpi-ingestion",
        reason: "Could not complete the authoritative CPI sync. Check server logs.",
      },
      { status: 500 }
    );
  }
}
