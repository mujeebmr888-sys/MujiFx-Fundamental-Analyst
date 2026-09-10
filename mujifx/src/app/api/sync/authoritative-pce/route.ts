/**
 * STEP 13M — AUTHORITATIVE PCE INGESTION
 *
 * Server-side ingestion route for official BEA PCE and Core PCE
 * price-change observations from NIPA Table 2.8.7.
 *
 * The BEA table publishes monthly percent changes. MUJIFX stores those
 * published values as-is; it does not re-annualize or infer release dates.
 */

import { NextResponse } from "next/server";
import {
  BEA_CORE_PCE_LINE_CODE,
  BEA_PCE_LINE_CODE,
  fetchBeaPcePilot,
} from "@/layers/data-acquisition/sources/bea-pce";
import { writeAuthoritativeBatch } from "@/layers/data-acquisition/authoritative-writer";
import type { AuthoritativeObservation } from "@/layers/data-acquisition/authoritative-writer";

export const dynamic = "force-dynamic";

const INDICATOR_BY_LINE = {
  [BEA_PCE_LINE_CODE]: "PCE",
  [BEA_CORE_PCE_LINE_CODE]: "CORE_PCE",
} as const;

export async function GET() {
  try {
    const result = await fetchBeaPcePilot(undefined, "LAST5");
    const observations: AuthoritativeObservation[] = [];

    const grouped = new Map<number, typeof result.observations>();
    for (const observation of result.observations) {
      const existing = grouped.get(observation.lineCode) ?? [];
      existing.push(observation);
      grouped.set(observation.lineCode, existing);
    }

    for (const [lineCode, items] of grouped) {
      const indicator = INDICATOR_BY_LINE[lineCode as keyof typeof INDICATOR_BY_LINE];
      if (!indicator) continue;

      const sorted = [...items].sort((a, b) =>
        a.timePeriod.localeCompare(b.timePeriod)
      );

      for (let index = 0; index < sorted.length; index += 1) {
        const item = sorted[index];
        if (!/^\d{4}-\d{2}$/.test(item.timePeriod)) continue;

        observations.push({
          indicator,
          periodCovered: item.timePeriod,
          actual: item.value,
          unit: "Percent change from preceding period",
          sourceName: "U.S. Bureau of Economic Analysis (BEA)",
          sourceUrl: "https://apps.bea.gov/api/data/",
          sourceTier: "TIER_1_OFFICIAL",
          sourceObservationId: `NIPA:T20807:${lineCode}:${item.timePeriod}`,
          sourceReleaseDate: null,
          sourceReleaseDateVerified: false,
          retrievedAt: result.retrievedAt,
          previous: index > 0 ? sorted[index - 1].value : null,
        });
      }
    }

    const results = await writeAuthoritativeBatch(
      "U.S. Bureau of Economic Analysis (BEA)",
      observations
    );

    return NextResponse.json({
      success: true,
      source: "BEA",
      table: "T20807",
      rowsSeen: observations.length,
      rowsWritten: results.reduce((sum, item) => sum + item.rowsWritten, 0),
      results,
    });
  } catch (error) {
    console.error("Authoritative PCE sync failed:", error);
    return NextResponse.json(
      {
        success: false,
        stage: "authoritative-pce-ingestion",
        reason: "Could not complete the authoritative PCE sync. Check server logs.",
      },
      { status: 500 }
    );
  }
}
