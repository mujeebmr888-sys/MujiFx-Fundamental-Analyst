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
        /^\\d{4}$/.test(item.year) &&
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

function parseSeries(
  data: BlsApiResponse,
  startYear: number,
  endYear: number
): BlsJoltsObservation[] {
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

function buildApiError(prefix: string, data: BlsApiResponse): Error {
  return new Error(
    `${prefix}: ${data.message?.join(" ") || "Unknown BLS API error."}`
  );
}

async function fetchJson(
  url: string,
  init: RequestInit,
  label: string
): Promise<BlsApiResponse> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const raw = await response.text();

  let data: BlsApiResponse;
  try {
    data = JSON.parse(raw) as BlsApiResponse;
  } catch {
    throw new Error(
      `${label} returned HTTP ${response.status} with a non-JSON response.`
    );
  }

  if (!response.ok) {
    throw new Error(
      `${label} returned HTTP ${response.status}: ${data.message?.join(" ") || raw.slice(0, 300)}`
    );
  }
  if (data.status !== "REQUEST_SUCCEEDED") {
    throw buildApiError(`${label} failed`, data);
  }

  return data;
}

/**
 * BLS documents GET as the single-series signature. We use it first because
 * it is the smallest request for one JOLTS series. If the GET path fails or
 * returns no observations in the requested window, retry with the documented
 * POST signature and an explicit year range. This keeps the adapter resilient
 * without downloading the large JOLTS flat file from a serverless function.
 */
async function fetchBlsJoltsApi(
  startYear: number,
  endYear: number
): Promise<BlsJoltsObservation[]> {
  const apiKey = process.env[BLS_API_KEY_ENV]?.trim();
  const getUrl = new URL(`${BLS_API_URL}${BLS_JOLTS_SERIES_ID}`);
  if (apiKey) getUrl.searchParams.set("registrationkey", apiKey);

  let getError: Error | null = null;
  try {
    const data = await fetchJson(
      getUrl.toString(),
      { headers: { Accept: "application/json" } },
      "BLS JOLTS GET"
    );
    const observations = parseSeries(data, startYear, endYear);
    if (observations.length > 0) return observations;
    getError = new Error(
      `BLS JOLTS GET returned no monthly observations for ${startYear}-${endYear}.`
    );
  } catch (error) {
    getError = error instanceof Error ? error : new Error(String(error));
  }

  const body: Record<string, unknown> = {
    seriesid: [BLS_JOLTS_SERIES_ID],
    startyear: String(startYear),
    endyear: String(endYear),
  };
  if (apiKey) body.registrationkey = apiKey;

  try {
    const data = await fetchJson(
      BLS_API_URL,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      "BLS JOLTS POST"
    );
    const observations = parseSeries(data, startYear, endYear);
    if (observations.length > 0) return observations;

    throw new Error(
      `BLS JOLTS POST returned no monthly observations for ${startYear}-${endYear}.`
    );
  } catch (postError) {
    const postMessage = postError instanceof Error ? postError.message : String(postError);
    throw new Error(
      `JOLTS acquisition failed. GET: ${getError?.message ?? "unknown"} POST: ${postMessage}`
    );
  }
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
