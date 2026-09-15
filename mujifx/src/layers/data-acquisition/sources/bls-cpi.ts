/**
 * STEP 13K — BLS CPI AUTHORITATIVE SOURCE ADAPTER
 *
 * Server-side, read-only source adapter for the authoritative BLS CPI series.
 * The adapter itself does not write to Supabase; the authoritative ingestion
 * route passes its observations to the shared authoritative writer.
 *
 * BLS year-bounded requests use the documented POST API signature.
 */

import {
  blsApiRetrievalProvenance,
  type AuthoritativeVersionProvenance,
} from "@/layers/data-acquisition/authoritative-version";

const BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
const BLS_API_KEY_ENV = "BLS";

export const BLS_CPI_SERIES_ID = "CUSR0000SA0";

export interface BlsMonthlyObservation {
  year: string;
  period: string;
  periodName: string;
  value: number;
  footnotes: Array<{ code: string | null; text: string | null }>;
}

export interface BlsCpiPilotResult {
  seriesId: typeof BLS_CPI_SERIES_ID;
  observations: BlsMonthlyObservation[];
  retrievedAt: string;
  versionProvenance: AuthoritativeVersionProvenance;
}

interface BlsApiObservation {
  year?: string;
  period?: string;
  periodName?: string;
  value?: string;
  footnotes?: Array<{ code?: string; text?: string }>;
}

interface BlsApiResponse {
  status?: string;
  message?: string[];
  Results?: {
    series?: Array<{
      seriesID?: string;
      data?: BlsApiObservation[];
    }>;
  };
}

export async function fetchBlsCpiPilot(
  startYear: number,
  endYear: number
): Promise<BlsCpiPilotResult> {
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) {
    throw new Error("BLS CPI pilot requires integer startYear and endYear.");
  }
  if (startYear > endYear) {
    throw new Error("BLS CPI pilot startYear cannot be after endYear.");
  }

  const apiKey = process.env[BLS_API_KEY_ENV]?.trim();
  const body: Record<string, unknown> = {
    seriesid: [BLS_CPI_SERIES_ID],
    startyear: String(startYear),
    endyear: String(endYear),
  };
  if (apiKey) body.registrationkey = apiKey;

  const res = await fetch(BLS_API_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`BLS CPI API returned HTTP ${res.status}.`);
  }

  const data = (await res.json()) as BlsApiResponse;
  if (data.status !== "REQUEST_SUCCEEDED") {
    const message = data.message?.join(" ") || "Unknown BLS API error.";
    throw new Error(`BLS CPI request failed: ${message}`);
  }

  const series = data.Results?.series?.find(
    (item) => item.seriesID === BLS_CPI_SERIES_ID
  );
  if (!series) {
    throw new Error(`BLS CPI series ${BLS_CPI_SERIES_ID} was not returned.`);
  }

  const observations: BlsMonthlyObservation[] = (series.data ?? [])
    .filter(
      (item) =>
        item.year &&
        /^M(0[1-9]|1[0-2])$/.test(item.period ?? "") &&
        item.value != null &&
        item.value !== "."
    )
    .map((item) => ({
      year: item.year as string,
      period: item.period as string,
      periodName: item.periodName ?? "",
      value: Number(item.value),
      footnotes: (item.footnotes ?? []).map((footnote) => ({
        code: footnote.code ?? null,
        text: footnote.text ?? null,
      })),
    }))
    .filter((item) => Number.isFinite(item.value));

  return {
    seriesId: BLS_CPI_SERIES_ID,
    observations,
    retrievedAt: new Date().toISOString(),
    versionProvenance: blsApiRetrievalProvenance(),
  };
}

/** Convert a BLS monthly period to MUJIFX's YYYY-MM format. */
export function blsPeriodToMonth(year: string, period: string): string {
  const month = period.replace("M", "");
  return `${year}-${month}`;
}
