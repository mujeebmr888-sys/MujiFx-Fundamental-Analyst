/**
 * STEP 13M — AUTHORITATIVE GDP INGESTION
 *
 * Server-side ingestion route for official BEA real GDP growth from
 * NIPA Table 1.1.1. The BEA-published quarterly annualized growth rate is
 * stored as-is; MUJIFX does not re-annualize it.
 */

import { NextResponse } from "next/server";
import {
  BEA_GDP_GROWTH_LINE_CODE,
  fetchBeaGdpGrowthPilot,
} from "@/layers/data-acquisition/sources/bea-gdp";
import { writeAuthoritativeBatch } from "@/layers/data-acquisition/authoritative-writer";
import type { AuthoritativeObservation } from "@/layers/data-acquisition/authoritative-writer";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await fetchBeaGdpGrowthPilot(undefined, "LAST5");

    const sorted = [...result.observations]
      .filter(
        (observation) =>
          observation.lineCode === BEA_GDP_GROWTH_LINE_CODE &&
          /^\d{4}:Q[1-4]$/.test(observation.timePeriod)
      )
      .sort((a, b) => a.timePeriod.localeCompare(b.timePeriod));

    const observations: AuthoritativeObservation[] = sorted.map(
      (observation, index) => ({
        indicator: "GDP_GROWTH_RATE",
        periodCovered: observation.timePeriod,
        actual: observation.value,
        unit: "Percent change at seasonally adjusted annual rate",
        sourceName: "U.S. Bureau of Economic Analysis (BEA)",
        sourceUrl: "https://apps.bea.gov/api/data/",
        sourceTier: "TIER_1_OFFICIAL",
        sourceObservationId: `NIPA:T10101:${BEA_GDP_GROWTH_LINE_CODE}:${observation.timePeriod}`,
        sourceReleaseDate: null,
        sourceReleaseDateVerified: false,
        retrievedAt: result.retrievedAt,
        previous: index > 0 ? sorted[index - 1].value : null,
      })
    );

    const results = await writeAuthoritativeBatch(
      "U.S. Bureau of Economic Analysis (BEA)",
      observations
    );

    return NextResponse.json({
      success: true,
      source: "BEA",
      table: "T10101",
      rowsSeen: observations.length,
      rowsWritten: results.reduce((sum, item) => sum + item.rowsWritten, 0),
      results,
    });
  } catch (error) {
    console.error("Authoritative GDP sync failed:", error);
    return NextResponse.json(
      {
        success: false,
        stage: "authoritative-gdp-ingestion",
        reason: "Could not complete the authoritative GDP sync. Check server logs.",
      },
      { status: 500 }
    );
  }
}
