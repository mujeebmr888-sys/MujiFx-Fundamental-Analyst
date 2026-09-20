/**
 * STEP 13M - AUTHORITATIVE GDP INGESTION
 *
 * Server-side ingestion route for official BEA real GDP growth from
 * NIPA Table 1.1.1. The BEA-published quarterly annualized growth rate is
 * stored as-is; MUJIFX does not re-annualize it.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/cron-auth";
import {
  BEA_GDP_GROWTH_LINE_CODE,
  fetchBeaGdpGrowthPilot,
} from "@/layers/data-acquisition/sources/bea-gdp";
import { writeAuthoritativeBatch } from "@/layers/data-acquisition/authoritative-writer";
import type { AuthoritativeObservation } from "@/layers/data-acquisition/authoritative-writer";

export const dynamic = "force-dynamic";

function normalizeBeaQuarter(timePeriod: string): string | null {
  const match = /^(\d{4})Q([1-4])$/.exec(timePeriod);
  if (!match) return null;

  const monthByQuarter = { "1": "01", "2": "04", "3": "07", "4": "10" } as const;
  return `${match[1]}-${monthByQuarter[match[2] as keyof typeof monthByQuarter]}`;
}

export async function GET(request: NextRequest) {
  // This route writes to the database and consumes an upstream API quota.
  const denied = requireCronSecret(request);
  if (denied) return denied;

  try {
    const result = await fetchBeaGdpGrowthPilot(undefined, "LAST5");

    const normalized = result.observations
      .filter((observation) => observation.lineCode === BEA_GDP_GROWTH_LINE_CODE)
      .map((observation) => ({
        observation,
        period: normalizeBeaQuarter(observation.timePeriod),
      }))
      .filter(
        (entry): entry is {
          observation: (typeof result.observations)[number];
          period: string;
        } => Boolean(entry.period)
      )
      .sort((a, b) => a.period.localeCompare(b.period));

    const observations: AuthoritativeObservation[] = normalized.map(
      (entry, index) => ({
        indicator: "GDP_GROWTH_RATE",
        periodCovered: entry.period,
        actual: entry.observation.value,
        unit: "Percent change at seasonally adjusted annual rate",
        sourceName: "U.S. Bureau of Economic Analysis (BEA)",
        sourceUrl: "https://apps.bea.gov/api/data/",
        sourceTier: "TIER_1_OFFICIAL",
        sourceObservationId: `NIPA:T10101:${BEA_GDP_GROWTH_LINE_CODE}:${entry.observation.timePeriod}`,
        sourceReleaseDate: null,
        sourceReleaseDateVerified: false,
        retrievedAt: result.retrievedAt,
        previous: index > 0 ? normalized[index - 1].observation.value : null,
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
