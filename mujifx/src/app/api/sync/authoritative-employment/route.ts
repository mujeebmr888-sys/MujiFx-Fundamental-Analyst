/**
 * STEP 13L - AUTHORITATIVE EMPLOYMENT INGESTION
 *
 * Server-side verification route for the authoritative BLS Employment
 * indicators and the shared authoritative writer.
 *
 * Scope: NFP, unemployment rate, and average hourly earnings only.
 * Release dates are not fabricated from observation periods.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/cron-auth";
import {
  BLS_EMPLOYMENT_SERIES,
  blsEmploymentPeriodToMonth,
  fetchBlsEmploymentPilot,
} from "@/layers/data-acquisition/sources/bls-employment";
import { writeAuthoritativeBatch } from "@/layers/data-acquisition/authoritative-writer";
import type { AuthoritativeObservation } from "@/layers/data-acquisition/authoritative-writer";

export const dynamic = "force-dynamic";

const INDICATOR_BY_SERIES = {
  [BLS_EMPLOYMENT_SERIES.NFP]: "NFP",
  [BLS_EMPLOYMENT_SERIES.UNEMPLOYMENT_RATE]: "UNEMPLOYMENT_RATE",
  [BLS_EMPLOYMENT_SERIES.AVG_HOURLY_EARNINGS]: "AVG_HOURLY_EARNINGS",
} as const;

const UNIT_BY_SERIES = {
  [BLS_EMPLOYMENT_SERIES.NFP]: "Thousands of persons",
  [BLS_EMPLOYMENT_SERIES.UNEMPLOYMENT_RATE]: "Percent",
  [BLS_EMPLOYMENT_SERIES.AVG_HOURLY_EARNINGS]: "Dollars per hour",
} as const;

export async function GET(request: NextRequest) {
  // This route writes to the database and consumes an upstream API quota.
  const denied = requireCronSecret(request);
  if (denied) return denied;

  try {
    const endYear = new Date().getUTCFullYear();
    const startYear = endYear - 1;
    const result = await fetchBlsEmploymentPilot(startYear, endYear);

    const observations: AuthoritativeObservation[] = [];
    const grouped = new Map<string, typeof result.observations>();

    for (const observation of result.observations) {
      const existing = grouped.get(observation.seriesId) ?? [];
      existing.push(observation);
      grouped.set(observation.seriesId, existing);
    }

    for (const [seriesId, items] of grouped) {
      const sorted = [...items].sort((a, b) =>
        blsEmploymentPeriodToMonth(a.year, a.period).localeCompare(
          blsEmploymentPeriodToMonth(b.year, b.period)
        )
      );
      const indicator = INDICATOR_BY_SERIES[seriesId as keyof typeof INDICATOR_BY_SERIES];
      const unit = UNIT_BY_SERIES[seriesId as keyof typeof UNIT_BY_SERIES];

      for (let index = 0; index < sorted.length; index += 1) {
        const item = sorted[index];
        observations.push({
          indicator,
          periodCovered: blsEmploymentPeriodToMonth(item.year, item.period),
          actual: item.value,
          unit,
          sourceName: "U.S. Bureau of Labor Statistics (BLS)",
          sourceUrl: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
          sourceTier: "TIER_1_OFFICIAL",
          sourceObservationId: `${seriesId}:${item.year}:${item.period}`,
          sourceReleaseDate: null,
          sourceReleaseDateVerified: false,
          retrievedAt: result.retrievedAt,
          previous: index > 0 ? sorted[index - 1].value : null,
        });
      }
    }

    const results = await writeAuthoritativeBatch(
      "U.S. Bureau of Labor Statistics (BLS)",
      observations
    );

    return NextResponse.json({
      success: true,
      source: "BLS",
      range: { startYear, endYear },
      rowsSeen: observations.length,
      rowsWritten: results.reduce((sum, item) => sum + item.rowsWritten, 0),
      results,
    });
  } catch (error) {
    console.error("Authoritative Employment sync failed:", error);
    return NextResponse.json(
      {
        success: false,
        stage: "authoritative-employment-ingestion",
        reason: "Could not complete the authoritative Employment sync. Check server logs.",
      },
      { status: 500 }
    );
  }
}
