import { NextResponse } from "next/server";
import {
  CENSUS_MRTS_SERIES_ID,
  fetchCensusRetailSales,
} from "@/layers/data-acquisition/sources/census-retail-sales";
import { writeAuthoritativeBatch } from "@/layers/data-acquisition/authoritative-writer";
import type { AuthoritativeObservation } from "@/layers/data-acquisition/authoritative-writer";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const endYear = new Date().getUTCFullYear();
    const startYear = endYear - 1;
    const retailSales = await fetchCensusRetailSales(startYear, endYear);

    const observations: AuthoritativeObservation[] = retailSales.observations.map((item) => ({
      indicator: "RETAIL_SALES",
      periodCovered: item.period,
      actual: item.value,
      unit: "million USD, seasonally adjusted",
      sourceName: "U.S. Census Bureau (Monthly Retail Trade Survey)",
      sourceUrl: "https://www.census.gov/retail/marts/www/timeseries.html",
      sourceTier: "TIER_1_OFFICIAL",
      sourceObservationId: `${CENSUS_MRTS_SERIES_ID}:${item.period}`,
      sourceReleaseDate: null,
      sourceReleaseDateVerified: false,
      retrievedAt: retailSales.retrievedAt,
    }));

    const results = await writeAuthoritativeBatch(
      "U.S. Census Bureau (Monthly Retail Trade Survey)",
      observations
    );

    return NextResponse.json({
      success: true,
      source: "U.S. Census Bureau (Monthly Retail Trade Survey)",
      range: { startYear, endYear },
      series: { RETAIL_SALES: CENSUS_MRTS_SERIES_ID },
      rowsSeen: observations.length,
      rowsWritten: results.reduce((sum, item) => sum + item.rowsWritten, 0),
      results,
    });
  } catch (error) {
    console.error("Authoritative U.S. Census retail sales sync failed:", error);
    return NextResponse.json(
      {
        success: false,
        stage: "authoritative-census-retail-sales-ingestion",
        reason:
          "Could not complete the authoritative U.S. Census retail sales sync. Check server logs.",
      },
      { status: 500 }
    );
  }
}
