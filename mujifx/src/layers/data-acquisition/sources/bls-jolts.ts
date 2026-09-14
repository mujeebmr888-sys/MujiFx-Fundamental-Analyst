const BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
const BLS_JOLTS_FLAT_FILE_URL =
  "https://download.bls.gov/pub/time.series/JT/jt.data.2.JobOpenings";
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
  observations: BlsJoltsObservation[]
): BlsJoltsObservation[] {
  return observations
    .filter(
      (item) =>
        /^\d{4}$/.test(item.year) &&
        /^M(0[1-9]|1[0-2])$/.test(item.period) &&
        Number.isFinite(item.value)
    )
    .sort((a, b) => {
      const left = `${a.year}-${a.period.slice(1)}`;
      const right = `${b.year}-${b.period.slice(1)}`;
      return left.localeCompare(right);
    });
}

async function fetchBlsJoltsApi(
  startYear: number,
  endYear: number
): Promise<BlsJoltsObservation[]> {
  const body: Record<string, unknown> = {
    seriesid: [BLS_JOLTS_SERIES_ID],
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

  return normalizeObservations(
    (series.data ?? [])
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
      .filter((item) => Number.isFinite(item.value))
  );
}

async function fetchBlsJoltsFlatFile(
  startYear: number,
  endYear: number
): Promise<BlsJoltsObservation[]> {
  const response = await fetch(BLS_JOLTS_FLAT_FILE_URL, {
    headers: { Accept: "text/plain", "User-Agent": "MUJIFX-Fundamental-Analyst/1.0" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`BLS JOLTS flat file returned HTTP ${response.status}.`);
  }

  const text = await response.text();
  const observations: BlsJoltsObservation[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("series_id")) continue;

    const fields = line.split(/\s+/);
    if (fields.length < 4) continue;

    const [seriesId, year, period, value] = fields;
    if (
      seriesId !== BLS_JOLTS_SERIES_ID ||
      !/^\d{4}$/.test(year) ||
      !/^M(0[1-9]|1[0-2])$/.test(period)
    ) {
      continue;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) continue;

    const month = Number(period.slice(1));
    const periodName = new Date(Date.UTC(2000, month - 1, 1)).toLocaleString(
      "en-US",
      { month: "long", timeZone: "UTC" }
    );

    observations.push({
      year,
      period,
      periodName,
      value: numericValue,
      footnotes: [],
    });
  }

  return normalizeObservations(
    observations.filter((item) => {
      const year = Number(item.year);
      return year >= startYear && year <= endYear;
    })
  );
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

  let observations: BlsJoltsObservation[] = [];

  try {
    observations = await fetchBlsJoltsApi(startYear, endYear);
  } catch (error) {
    console.warn(
      "BLS JOLTS API path failed; trying the official BLS JOLTS flat file.",
      error
    );
  }

  // The official BLS flat-file dataset is the deterministic fallback when the
  // public API returns an empty series or otherwise fails. No values are
  // fabricated or interpolated.
  if (observations.length === 0) {
    observations = await fetchBlsJoltsFlatFile(startYear, endYear);
  }

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
