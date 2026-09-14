const BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
const BLS_API_KEY_ENV = "BLS";

export const BLS_PPI_SERIES_ID = "WPU00000000";

export interface BlsPpiObservation {
  year: string;
  period: string;
  periodName: string;
  value: number;
  footnotes: Array<{ code: string | null; text: string | null }>;
}

export interface BlsPpiResult {
  seriesId: typeof BLS_PPI_SERIES_ID;
  observations: BlsPpiObservation[];
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

export async function fetchBlsPpi(startYear: number, endYear: number): Promise<BlsPpiResult> {
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) {
    throw new Error("BLS PPI requires integer startYear and endYear.");
  }
  if (startYear > endYear) {
    throw new Error("BLS PPI startYear cannot be after endYear.");
  }

  const body: Record<string, unknown> = {
    seriesid: [BLS_PPI_SERIES_ID],
    startyear: String(startYear),
    endyear: String(endYear),
  };
  const apiKey = process.env[BLS_API_KEY_ENV]?.trim();
  if (apiKey) body.registrationkey = apiKey;

  const response = await fetch(BLS_API_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`BLS PPI API returned HTTP ${response.status}.`);
  }

  const data = (await response.json()) as BlsApiResponse;
  if (data.status !== "REQUEST_SUCCEEDED") {
    throw new Error(
      `BLS PPI request failed: ${data.message?.join(" ") || "Unknown BLS API error."}`
    );
  }

  const series = data.Results?.series?.find((item) => item.seriesID === BLS_PPI_SERIES_ID);
  if (!series) {
    throw new Error(`BLS PPI series ${BLS_PPI_SERIES_ID} was not returned.`);
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

  return {
    seriesId: BLS_PPI_SERIES_ID,
    observations,
    retrievedAt: new Date().toISOString(),
  };
}

export function blsPpiPeriodToMonth(year: string, period: string): string {
  return `${year}-${period.replace("M", "")}`;
}
