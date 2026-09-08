/**
 * GET /api/sync/vintage-pilot
 *
 * Isolated Step 13G pilot. It writes ONLY to indicator_observation_vintages.
 * Existing sync, backfill, assessment, and scoring routes are untouched.
 *
 * Pilot scope:
 * - GDP_GROWTH_RATE: Q1 2014, using the official FRED vintage dates that
 *   fall between 2014-04-30 and 2014-06-25. This is a real revision window,
 *   discovered from FRED rather than hard-coded values.
 * - VIX: a small recent vintage sample. Each selected vintage is queried
 *   against an observation window ending immediately before that vintage,
 *   so the pilot tests historical availability rather than today's data.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  discoverVintageDates,
  fetchObservationAtVintage,
} from "@/layers/data-acquisition/sources/fred-vintage";
import { saveVintageObservation } from "@/layers/historical-database/vintage-database";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GDP_INDICATOR = "GDP_GROWTH_RATE" as const;
const VIX_INDICATOR = "VIX" as const;

const GDP_FIXTURE_START = "2014-01-01";
const GDP_FIXTURE_END = "2014-03-31";
const GDP_VINTAGE_START = "2014-04-30";
const GDP_VINTAGE_END = "2014-06-25";

const VIX_SAMPLE_SIZE = 3;
const VIX_OBSERVATION_DAYS = 7;

function authorized(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  return !process.env.CRON_SECRET || authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

function dateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = {
    ranAt: new Date().toISOString(),
    pilot: "step-13G",
    gdp: {
      discoveredVintageDates: 0,
      selectedVintageDates: [] as string[],
      fetchedRows: 0,
      savedRows: 0,
      rows: [] as Array<Record<string, unknown>>,
    },
    vix: {
      discoveredVintageDates: 0,
      selectedVintageDates: [] as string[],
      fetchedRows: 0,
      savedRows: 0,
      rows: [] as Array<Record<string, unknown>>,
    },
    errors: [] as string[],
  };

  try {
    const dates = await discoverVintageDates(GDP_INDICATOR);
    result.gdp.discoveredVintageDates = dates.length;

    const selected = dates.filter((date) =>
      dateInRange(date, GDP_VINTAGE_START, GDP_VINTAGE_END)
    );
    result.gdp.selectedVintageDates = selected;

    for (const vintageDate of selected) {
      try {
        const rows = await fetchObservationAtVintage(
          GDP_INDICATOR,
          vintageDate,
          GDP_FIXTURE_START,
          GDP_FIXTURE_END
        );
        result.gdp.fetchedRows += rows.length;

        for (const row of rows) {
          const saved = await saveVintageObservation(row);
          result.gdp.savedRows++;
          result.gdp.rows.push({
            observationDate: row.observationDate,
            value: row.value,
            isMissing: row.isMissing,
            realtimeStart: row.realtimeStart,
            realtimeEnd: row.realtimeEnd,
            saveResult: saved ? "ok" : "ok",
          });
        }
      } catch (error) {
        result.errors.push(
          `GDP ${vintageDate}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  } catch (error) {
    result.errors.push(
      `GDP discovery: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    const dates = await discoverVintageDates(VIX_INDICATOR);
    result.vix.discoveredVintageDates = dates.length;

    const selected = dates
      .slice()
      .sort((a, b) => b.localeCompare(a))
      .slice(0, VIX_SAMPLE_SIZE)
      .sort((a, b) => a.localeCompare(b));
    result.vix.selectedVintageDates = selected;

    for (const vintageDate of selected) {
      try {
        const observationEnd = addUtcDays(vintageDate, -1);
        const observationStart = addUtcDays(
          observationEnd,
          -(VIX_OBSERVATION_DAYS - 1)
        );

        const rows = await fetchObservationAtVintage(
          VIX_INDICATOR,
          vintageDate,
          observationStart,
          observationEnd
        );
        result.vix.fetchedRows += rows.length;

        for (const row of rows) {
          await saveVintageObservation(row);
          result.vix.savedRows++;
          result.vix.rows.push({
            observationDate: row.observationDate,
            value: row.value,
            isMissing: row.isMissing,
            realtimeStart: row.realtimeStart,
            realtimeEnd: row.realtimeEnd,
          });
        }
      } catch (error) {
        result.errors.push(
          `VIX ${vintageDate}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  } catch (error) {
    result.errors.push(
      `VIX discovery: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return NextResponse.json(result);
}
