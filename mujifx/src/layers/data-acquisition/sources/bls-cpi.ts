/**
 * STEP 13J — BLS CPI SOURCE PILOT
 *
 * Isolated, read-only source adapter for the authoritative BLS CPI series.
 * This pilot intentionally does NOT write to the production database and
 * does NOT replace the existing FRED transport yet.
 */

const BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

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

/**
 * Fetches BLS CPI-U U.S. city average, all items, seasonally adjusted.
 *
 * Important: BLS API observations contain observation periods, not the
 * official publication timestamp. Therefore this function returns only
 * source observations and never maps observation date to releaseDate.
 */
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

  const url = new URL(BLS_API_URL);
  url.searchParams.set("seriesid", BLS_CPI_SERIES_ID);
  url.searchParams.set("startyear", String(startYear));
  url.searchParams.set("endyear", String(endYear));

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`BLS API returned HTTP ${res.status}.`);
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
    throw new Error(
      `BLS CPI series ${BLS_CPI_SERIES_ID} was not returned by the API.`
    );
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
  };
}

/** Convert a BLS monthly period to MUJIFX's YYYY-MM format. */
export function blsPeriodToMonth(year: string, period: string): string {
  const month = period.replace("M", "");
  return `${year}-${month}`;
}
