/**
 * Authoritative BLS Core CPI source adapter.
 *
 * Source observations only; database persistence is handled by the shared
 * authoritative writer.
 */

const BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
const BLS_API_KEY_ENV = "BLS";

export const BLS_CORE_CPI_SERIES_ID = "CUSR0000SA0L1E";

export interface BlsCoreCpiObservation {
  year: string;
  period: string;
  periodName: string;
  value: number;
  footnotes: Array<{ code: string | null; text: string | null }>;
}

export interface BlsCoreCpiPilotResult {
  seriesId: typeof BLS_CORE_CPI_SERIES_ID;
  observations: BlsCoreCpiObservation[];
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
 * Fetches BLS CPI-U U.S. city average, all items less food and energy,
 * seasonally adjusted.
 *
 * BLS documents POST for requests specifying a year range. Using that
 * documented signature avoids relying on unsupported GET query parameters.
 */
export async function fetchBlsCoreCpiPilot(
  startYear: number,
  endYear: number
): Promise<BlsCoreCpiPilotResult> {
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) {
    throw new Error("BLS Core CPI requires integer startYear and endYear.");
  }

  if (startYear > endYear) {
    throw new Error("BLS Core CPI startYear cannot be after endYear.");
  }

  const body: Record<string, unknown> = {
    seriesid: [BLS_CORE_CPI_SERIES_ID],
    startyear: String(startYear),
    endyear: String(endYear),
  };

  const apiKey = process.env[BLS_API_KEY_ENV]?.trim();
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
    throw new Error(`BLS Core CPI API returned HTTP ${res.status}.`);
  }

  const data = (await res.json()) as BlsApiResponse;

  if (data.status !== "REQUEST_SUCCEEDED") {
    const message = data.message?.join(" ") || "Unknown BLS API error.";
    throw new Error(`BLS Core CPI request failed: ${message}`);
  }

  const series = data.Results?.series?.find(
    (item) => item.seriesID === BLS_CORE_CPI_SERIES_ID
  );

  if (!series) {
    throw new Error(
      `BLS Core CPI series ${BLS_CORE_CPI_SERIES_ID} was not returned by the API.`
    );
  }

  const observations: BlsCoreCpiObservation[] = (series.data ?? [])
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

  if (observations.length === 0) {
    throw new Error(
      `BLS Core CPI API returned no monthly observations for ${startYear}-${endYear}.`
    );
  }

  return {
    seriesId: BLS_CORE_CPI_SERIES_ID,
    observations,
    retrievedAt: new Date().toISOString(),
  };
}
