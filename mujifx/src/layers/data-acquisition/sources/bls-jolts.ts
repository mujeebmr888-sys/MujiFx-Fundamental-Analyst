const BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
const BLS_API_KEY_ENV = "BLS";

// Current BLS seasonally adjusted Total Nonfarm, Job Openings, Total U.S. series.
export const BLS_JOLTS_SERIES_ID = "JTS00000000JOL";

export interface BlsJoltsObservation {
  year: string;
  period: string;
  periodName: string;
  value: number;
  footnotes: Array<{ code: string | null; text: string | null }>;
}

export interface BlsJoltsResult {
  seriesId: typeof BLS_JOLTS_SERIES_ID;
  observations: BlsJoltsObservation[];
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
    series?: Array<{ seriesID?: string; data?: BlsApiObservation[] }>;
  };
}

function normalizeObservations(
  observations: BlsJoltsObservation[],
  startYear: number,
  endYear: number
): BlsJoltsObservation[] {
  return observations
    .filter(
      (item) =>
        /^\d{4}$/.test(item.year) &&
        Number(item.year) >= startYear &&
        Number(item.year) <= endYear &&
        /^M(0[1-9]|1[0-2])$/.test(item.period) &&
        Number.isFinite(item.value)
    )
    .sort((a, b) => {
      const left = `${a.year}-${a.period.slice(1)}`;
      const right = `${b.year}-${b.period.slice(1)}`;
      return left.localeCompare(right);
    });
}

/**
 * BLS documents GET as the single-series signature. It returns the recent
 * history for one series, which is sufficient for the two-year ingestion
 * window used by this route and avoids downloading the multi-megabyte JOLTS
 * flat file from a serverless function.
 */
async function fetchBlsJoltsApi(
  startYear: number,
  endYear: number
): Promise<BlsJoltsObservation[]> {
  const response = await fetch(
    `${BLS_API_URL}${BLS_JOLTS_SERIES_ID}`,
    {
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(`BLS JOLTS API returned HTTP ${response.status}.`);
  }

  const data = (await response.json()) as BlsApiResponse;
  if (data.status !== "REQUEST_SUCCEEDED") {
    throw new Error(
      `BLS JOLTS request failed: ${data.message?.join(" ") || "Unknown BLS API error."}`
    );
  }

  const series = data.Results?.series?.find(
    (item) => item.seriesID === BLS_JOLTS_SERIES_ID
  );
  if (!series) {
    throw new Error(`BLS JOLTS series ${BLS_JOLTS_SERIES_ID} was not returned.`);
  }

  const observations = (series.data ?? [])
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

  return normalizeObservations(observations, startYear, endYear);
}

export async function fetchBlsJolts(
  startYear: number,
  endYear: number
): Promise<BlsJoltsResult> {
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) {
    throw new Error("BLS JOLTS requires integer startYear and endYear.");
  }
  if (startYear > endYear) {
    throw new Error("BLS JOLTS startYear cannot be after endYear.");
  }

  const observations = await fetchBlsJoltsApi(startYear, endYear);

  if (observations.length === 0) {
    throw new Error(
      `BLS JOLTS returned no monthly observations for ${startYear}-${endYear}.`
    );
  }

  return {
    seriesId: BLS_JOLTS_SERIES_ID,
    observations,
    retrievedAt: new Date().toISOString(),
  };
}

export function blsJoltsPeriodToMonth(year: string, period: string): string {
  return `${year}-${period.replace("M", "")}`;
}
