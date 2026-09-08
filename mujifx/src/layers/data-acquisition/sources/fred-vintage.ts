/**
 * FRED / ALFRED vintage acquisition for the Step 13G pilot.
 *
 * This module is intentionally separate from fred.ts so the existing latest
 * sync and historical backfill behavior remain untouched.
 */

import type { IndicatorId } from "@/types/economic-data";

const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series";

const FRED_SERIES_MAP: Partial<Record<IndicatorId, string>> = {
  GDP_GROWTH_RATE: "A191RL1Q225SBEA",
  VIX: "VIXCLS",
};

type FredVintageDateResponse = {
  vintage_dates?: string[];
};

type FredObservation = {
  date: string;
  value: string;
  realtime_start?: string;
  realtime_end?: string;
};

type FredObservationResponse = {
  observations?: FredObservation[];
};

export type VintageObservation = {
  indicator: IndicatorId;
  observationDate: string;
  value: number | null;
  isMissing: boolean;
  realtimeStart: string;
  realtimeEnd: string | null;
  retrievedAt: string;
  sourceName: string;
  sourceUrl: string;
  sourceTier: "TIER_1_OFFICIAL";
};

function getApiKey(): string | null {
  return process.env.FRED_API_KEY?.trim() || null;
}

function getSeriesId(indicator: IndicatorId): string {
  const seriesId = FRED_SERIES_MAP[indicator];
  if (!seriesId) {
    throw new Error(`No FRED vintage series mapped for ${indicator}`);
  }
  return seriesId;
}

async function fredJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`FRED API returned HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/** Discover official FRED vintage dates for one series. */
export async function discoverVintageDates(
  indicator: IndicatorId
): Promise<string[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("FRED_API_KEY is not configured");

  const seriesId = getSeriesId(indicator);
  const url = `${FRED_BASE_URL}/vintagedates?series_id=${encodeURIComponent(
    seriesId
  )}&api_key=${encodeURIComponent(apiKey)}&file_type=json`;

  const data = await fredJson<FredVintageDateResponse>(url);
  return (data.vintage_dates ?? []).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
}

/**
 * Fetch one complete FRED real-time period. The response's own realtime
 * fields are preserved; they are never inferred from the request date.
 */
export async function fetchObservationAtVintage(
  indicator: IndicatorId,
  vintageDate: string,
  observationStart?: string,
  observationEnd?: string
): Promise<VintageObservation[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("FRED_API_KEY is not configured");

  const seriesId = getSeriesId(indicator);
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    realtime_start: vintageDate,
    realtime_end: vintageDate,
    output_type: "1",
    sort_order: "asc",
  });

  if (observationStart) params.set("observation_start", observationStart);
  if (observationEnd) params.set("observation_end", observationEnd);

  const url = `${FRED_BASE_URL}/observations?${params.toString()}`;
  const data = await fredJson<FredObservationResponse>(url);
  const retrievedAt = new Date().toISOString();

  return (data.observations ?? []).map((observation) => normalizeVintageRow(
    indicator,
    observation,
    retrievedAt
  ));
}

/** Normalize exactly one FRED observation; "." remains missing, never fabricated. */
export function normalizeVintageRow(
  indicator: IndicatorId,
  observation: FredObservation,
  retrievedAt: string
): VintageObservation {
  const isMissing = observation.value === ".";
  const parsedValue = isMissing ? null : Number(observation.value);

  if (!isMissing && !Number.isFinite(parsedValue)) {
    throw new Error(
      `Invalid FRED value for ${indicator} on ${observation.date}: ${observation.value}`
    );
  }

  if (!observation.realtime_start) {
    throw new Error(
      `FRED did not return realtime_start for ${indicator} on ${observation.date}`
    );
  }

  return {
    indicator,
    observationDate: observation.date,
    value: parsedValue,
    isMissing,
    realtimeStart: observation.realtime_start,
    realtimeEnd: observation.realtime_end ?? null,
    retrievedAt,
    sourceName: `FRED (series ${getSeriesId(indicator)})`,
    sourceUrl: "https://fred.stlouisfed.org/",
    sourceTier: "TIER_1_OFFICIAL",
  };
}
