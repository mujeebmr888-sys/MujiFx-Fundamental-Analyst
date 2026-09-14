const BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
const BLS_JOLTS_FLAT_FILE_URL = "https://download.bls.gov/pub/time.series/JT/jt.data.2.JobOpenings";

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

const PERIOD_NAMES: Record<string, string> = {
  M01: "January",
  M02: "February",
  M03: "March",
  M04: "April",
  M05: "May",
  M06: "June",
  M07: "July",
  M08: "August",
  M09: "September",
  M10: "October",
  M11: "November",
  M12: "December",
};

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

function parseApiSeries(
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
      periodName: item.periodName ?? PERIOD_NAMES[item.period as string] ?? "",
      value: Number(item.value),
      footnotes: (item.footnotes ?? []).map((footnote) => ({
        code: footnote.code ?? null,
        text: footnote.text ?? null,
      })),
    }))
    .filter((item) => Number.isFinite(item.value));

  return normalizeObservations(observations, startYear, endYear);
}

async function fetchBlsJoltsApi(
  startYear: number,
  endYear: number
): Promise<BlsJoltsObservation[]> {
  const response = await fetch(`${BLS_API_URL}${BLS_JOLTS_SERIES_ID}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`BLS JOLTS API returned HTTP ${response.status}.`);
  }

  const data = (await response.json()) as BlsApiResponse;
  if (data.status !== "REQUEST_SUCCEEDED") {
    throw new Error(
      `BLS JOLTS API request failed: ${data.message?.join(" ") || "Unknown BLS API error."}`
    );
  }

  return parseApiSeries(data, startYear, endYear);
}

async function fetchBlsJoltsFlatFile(
  startYear: number,
  endYear: number
): Promise<BlsJoltsObservation[]> {
  const response = await fetch(BLS_JOLTS_FLAT_FILE_URL, {
    headers: {
      Accept: "text/plain",
      "User-Agent": "MUJIFX Fundamental Analyst",
    },
    cache: "no-store",
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `BLS JOLTS flat file returned HTTP ${response.status} or no readable response body.`
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let headerSeen = false;
  const observations: BlsJoltsObservation[] = [];

  const processLine = (rawLine: string) => {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) return;

    if (!headerSeen) {
      headerSeen = true;
      return;
    }

    const fields = line.split("\t").map((field) => field.trim());
    const [seriesId, year, period, value, footnoteCodes] = fields;

    if (seriesId !== BLS_JOLTS_SERIES_ID) return;
    if (!/^\d{4}$/.test(year ?? "")) return;
    if (!/^M(0[1-9]|1[0-2])$/.test(period ?? "")) return;
    if (Number(year) < startYear || Number(year) > endYear) return;
    if (value == null || value === "." || value === "") return;

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;

    observations.push({
      year,
      period,
      periodName: PERIOD_NAMES[period] ?? period,
      value: numericValue,
      footnotes: (footnoteCodes ?? "")
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean)
        .map((code) => ({ code, text: null })),
    });
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    }

    buffer += decoder.decode();
    if (buffer) processLine(buffer);
  } finally {
    reader.releaseLock();
  }

  return normalizeObservations(observations, startYear, endYear);
}

/**
 * Primary transport is the official BLS single-series API. If BLS API returns
 * a successful response with no observations for the requested years, fall
 * back to the official BLS JOLTS flat file. The flat file is streamed and
 * filtered line-by-line so the serverless route never loads the 6MB+ file
 * into memory. No third-party or FRED source is used.
 */
async function fetchBlsJoltsOfficial(
  startYear: number,
  endYear: number
): Promise<BlsJoltsObservation[]> {
  let apiError: Error | null = null;

  try {
    const observations = await fetchBlsJoltsApi(startYear, endYear);
    if (observations.length > 0) return observations;
    apiError = new Error(
      `BLS JOLTS API returned no monthly observations for ${startYear}-${endYear}.`
    );
  } catch (error) {
    apiError = error instanceof Error ? error : new Error(String(error));
  }

  try {
    const observations = await fetchBlsJoltsFlatFile(startYear, endYear);
    if (observations.length > 0) return observations;
    throw new Error(
      `BLS JOLTS flat file returned no monthly observations for ${startYear}-${endYear}.`
    );
  } catch (flatFileError) {
    const flatMessage =
      flatFileError instanceof Error ? flatFileError.message : String(flatFileError);
    throw new Error(
      `JOLTS acquisition failed. API: ${apiError?.message ?? "unknown"} FlatFile: ${flatMessage}`
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

  const observations = await fetchBlsJoltsOfficial(startYear, endYear);

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
