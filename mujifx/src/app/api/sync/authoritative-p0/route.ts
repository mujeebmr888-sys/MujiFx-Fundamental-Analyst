/**
 * STEP 13M — AUTHORITATIVE P0 SYNC
 *
 * Single manual server-side entry point for the approved P0 source contracts:
 * BLS CPI/Core CPI + Employment, BEA PCE/Core PCE + GDP growth, and the
 * Federal Reserve H.15 effective federal funds rate.
 *
 * This route only moves official observations into the existing database
 * contract. It does not calculate assessments, forecasts, or trading signals.
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
import {
  BLS_EMPLOYMENT_SERIES,
  blsEmploymentPeriodToMonth,
  fetchBlsEmploymentPilot,
} from "@/layers/data-acquisition/sources/bls-employment";
import {
  BEA_CORE_PCE_LINE_CODE,
  BEA_PCE_LINE_CODE,
  fetchBeaPcePilot,
} from "@/layers/data-acquisition/sources/bea-pce";
import {
  BEA_GDP_GROWTH_LINE_CODE,
  fetchBeaGdpGrowthPilot,
} from "@/layers/data-acquisition/sources/bea-gdp";
import {
  FED_FUNDS_H15_SERIES_ID,
  fetchFedFundsPilot,
} from "@/layers/data-acquisition/sources/fed-funds";
import { writeAuthoritativeBatch } from "@/layers/data-acquisition/authoritative-writer";
import type { AuthoritativeObservation } from "@/layers/data-acquisition/authoritative-writer";

export const dynamic = "force-dynamic";

function mapBlsIndexRows(
  indicator: "CPI" | "CORE_CPI",
  seriesId: string,
  rows: Array<{ year: string; period: string; value: number }>,
  retrievedAt: string
): AuthoritativeObservation[] {
  const sorted = [...rows].sort((a, b) =>
    blsPeriodToMonth(a.year, a.period).localeCompare(
      blsPeriodToMonth(b.year, b.period)
    )
  );

  return sorted.map((row, index) => ({
    indicator,
    periodCovered: blsPeriodToMonth(row.year, row.period),
    actual: row.value,
    unit: "Index 1982-84=100",
    sourceName: "U.S. Bureau of Labor Statistics (BLS)",
    sourceUrl: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
    sourceTier: "TIER_1_OFFICIAL",
    sourceObservationId: `${seriesId}:${row.year}:${row.period}`,
    sourceReleaseDate: null,
    sourceReleaseDateVerified: false,
    retrievedAt,
    previous: index > 0 ? sorted[index - 1].value : null,
  }));
}

function mapBlsEmploymentRows(
  seriesId: string,
  rows: Array<{ year: string; period: string; value: number }>,
  retrievedAt: string
): AuthoritativeObservation[] {
  const indicatorBySeries = {
    [BLS_EMPLOYMENT_SERIES.NFP]: "NFP",
    [BLS_EMPLOYMENT_SERIES.UNEMPLOYMENT_RATE]: "UNEMPLOYMENT_RATE",
    [BLS_EMPLOYMENT_SERIES.AVG_HOURLY_EARNINGS]: "AVG_HOURLY_EARNINGS",
  } as const;

  const unitBySeries = {
    [BLS_EMPLOYMENT_SERIES.NFP]: "Thousands of persons",
    [BLS_EMPLOYMENT_SERIES.UNEMPLOYMENT_RATE]: "Percent",
    [BLS_EMPLOYMENT_SERIES.AVG_HOURLY_EARNINGS]: "Dollars per hour",
  } as const;

  const indicator = indicatorBySeries[seriesId as keyof typeof indicatorBySeries];
  const unit = unitBySeries[seriesId as keyof typeof unitBySeries];
  if (!indicator || !unit) return [];

  const sorted = [...rows].sort((a, b) =>
    blsEmploymentPeriodToMonth(a.year, a.period).localeCompare(
      blsEmploymentPeriodToMonth(b.year, b.period)
    )
  );

  return sorted.map((row, index) => ({
    indicator,
    periodCovered: blsEmploymentPeriodToMonth(row.year, row.period),
    actual: row.value,
    unit,
    sourceName: "U.S. Bureau of Labor Statistics (BLS)",
    sourceUrl: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
    sourceTier: "TIER_1_OFFICIAL",
    sourceObservationId: `${seriesId}:${row.year}:${row.period}`,
    sourceReleaseDate: null,
    sourceReleaseDateVerified: false,
    retrievedAt,
    previous: index > 0 ? sorted[index - 1].value : null,
  }));
}

function normalizeBeaMonth(timePeriod: string): string | null {
  const match = /^(\d{4})M(0[1-9]|1[0-2])$/.exec(timePeriod);
  return match ? `${match[1]}-${match[2]}` : null;
}

function normalizeBeaQuarter(timePeriod: string): string | null {
  const match = /^(\d{4})Q([1-4])$/.exec(timePeriod);
  if (!match) return null;
  const monthByQuarter = { "1": "01", "2": "04", "3": "07", "4": "10" } as const;
  return `${match[1]}-${monthByQuarter[match[2] as keyof typeof monthByQuarter]}`;
}

export async function GET() {
  const endYear = new Date().getUTCFullYear();
  const startYear = endYear - 1;

  try {
    const [cpi, coreCpi, employment, pce, gdp, fedFunds] = await Promise.all([
      fetchBlsCpiPilot(startYear, endYear),
      fetchBlsCoreCpiPilot(startYear, endYear),
      fetchBlsEmploymentPilot(startYear, endYear),
      fetchBeaPcePilot(undefined, "LAST5"),
      fetchBeaGdpGrowthPilot(undefined, "LAST5"),
      fetchFedFundsPilot(),
    ]);

    const observations: AuthoritativeObservation[] = [
      ...mapBlsIndexRows("CPI", cpi.seriesId, cpi.observations, cpi.retrievedAt),
      ...mapBlsIndexRows(
        "CORE_CPI",
        BLS_CORE_CPI_SERIES_ID,
        coreCpi.observations,
        coreCpi.retrievedAt
      ),
    ];

    for (const seriesId of Object.values(BLS_EMPLOYMENT_SERIES)) {
      const rows = employment.observations.filter(
        (observation) => observation.seriesId === seriesId
      );
      observations.push(
        ...mapBlsEmploymentRows(seriesId, rows, employment.retrievedAt)
      );
    }

    for (const lineCode of [BEA_PCE_LINE_CODE, BEA_CORE_PCE_LINE_CODE]) {
      const indicator = lineCode === BEA_PCE_LINE_CODE ? "PCE" : "CORE_PCE";
      const normalized = pce.observations
        .filter((observation) => observation.lineCode === lineCode)
        .map((observation) => ({
          observation,
          period: normalizeBeaMonth(observation.timePeriod),
        }))
        .filter(
          (entry): entry is {
            observation: (typeof pce.observations)[number];
            period: string;
          } => Boolean(entry.period)
        )
        .sort((a, b) => a.period.localeCompare(b.period));

      normalized.forEach((entry, index) => {
        observations.push({
          indicator,
          periodCovered: entry.period,
          actual: entry.observation.value,
          unit: "Percent change from preceding period",
          sourceName: "U.S. Bureau of Economic Analysis (BEA)",
          sourceUrl: "https://apps.bea.gov/api/data/",
          sourceTier: "TIER_1_OFFICIAL",
          sourceObservationId: `NIPA:T20807:${lineCode}:${entry.observation.timePeriod}`,
          sourceReleaseDate: null,
          sourceReleaseDateVerified: false,
          retrievedAt: pce.retrievedAt,
          previous: index > 0 ? normalized[index - 1].observation.value : null,
        });
      });
    }

    const normalizedGdp = gdp.observations
      .filter((observation) => observation.lineCode === BEA_GDP_GROWTH_LINE_CODE)
      .map((observation) => ({
        observation,
        period: normalizeBeaQuarter(observation.timePeriod),
      }))
      .filter(
        (entry): entry is {
          observation: (typeof gdp.observations)[number];
          period: string;
        } => Boolean(entry.period)
      )
      .sort((a, b) => a.period.localeCompare(b.period));

    normalizedGdp.forEach((entry, index) => {
      observations.push({
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
        retrievedAt: gdp.retrievedAt,
        previous: index > 0 ? normalizedGdp[index - 1].observation.value : null,
      });
    });

    const fedRows = [...fedFunds.observations].sort((a, b) =>
      a.period.localeCompare(b.period)
    );

    fedRows.forEach((row, index) => {
      observations.push({
        indicator: "FED_FUNDS_RATE",
        periodCovered: row.period,
        actual: row.value,
        unit: "Percent per year",
        sourceName: "Federal Reserve Board (H.15)",
        sourceUrl: "https://www.federalreserve.gov/datadownload/Preview.aspx",
        sourceTier: "TIER_1_OFFICIAL",
        sourceObservationId: `H15:${FED_FUNDS_H15_SERIES_ID}:${row.period}`,
        sourceReleaseDate: null,
        sourceReleaseDateVerified: false,
        retrievedAt: fedFunds.retrievedAt,
        previous: index > 0 ? fedRows[index - 1].value : null,
      });
    });

    const results = await writeAuthoritativeBatch(
      "MUJIFX P0 Official Sources (BLS/BEA/Federal Reserve)",
      observations
    );

    return NextResponse.json({
      success: true,
      source: "BLS + BEA + Federal Reserve",
      range: { startYear, endYear },
      rowsSeen: observations.length,
      rowsWritten: results.reduce((sum, item) => sum + item.rowsWritten, 0),
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Authoritative P0 sync failed:", message);
    return NextResponse.json(
      {
        success: false,
        stage: "authoritative-p0-ingestion",
        reason: "Could not complete the authoritative P0 sync.",
        error: message,
      },
      { status: 500 }
    );
  }
}
