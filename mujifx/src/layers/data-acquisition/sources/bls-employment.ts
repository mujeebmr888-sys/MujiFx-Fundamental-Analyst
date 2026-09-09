/**
 * STEP 13J — BLS EMPLOYMENT SOURCE PILOT
 *
 * Isolated, read-only source adapter for authoritative BLS employment
 * indicators used by the MUJIFX Employment category.
 *
 * This pilot intentionally does NOT write to the production database,
 * does NOT assign releaseDate from observation period, and does NOT replace
 * the existing FRED transport yet.
 *
 * If configured, the registered BLS API key is read server-side from the
 * Vercel environment variable named BLS.
 */

const BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
const BLS_API_KEY_ENV = "BLS";

export const BLS_EMPLOYMENT_SERIES = {
  NFP: "CES0000000001",
  UNEMPLOYMENT_RATE: "LNS14000000",
  AVG_HOURLY_EARNINGS: "CES0500000003",
} as const;

export type BlsEmploymentIndicator =
  (typeof BLS_EMPLOYMENT_SERIES)[keyof typeof BLS_EMPLOYMENT_SERIES];

export interface BlsEmploymentObservation {
  seriesId: BlsEmploymentIndicator;
  year: string;
  period: string;
  periodName: string;
  value: number;
  footnotes: Array<{ code: string | null; text: string | null }>;
}

export interface BlsEmploymentPilotResult {
  observations: BlsEmploymentObservation[];
  retrievedAt: string;
}

interface BlsApiObservation {
  year?: string;
  period?: string;
  periodName?: string;
  value?: string;
  footnotes?: Array<{ code?: string; text?: string }>;
}

interface BlsApiSeries {
  seriesID?: string;
  data?: BlsApiObservation[];
}

interface BlsApiResponse {
  status?: string;
  message?: string[];
  Results?: {
    series?: BlsApiSeries[];
  };
}

function isEmploymentSeries(value: string): value is BlsEmploymentIndicator {
  return Object.values(BLS_EMPLOYMENT_SERIES).includes(
    value as BlsEmploymentIndicator
  );
}

/**
 * Fetch authoritative BLS monthly observations for the three core
 * Employment-category P0 indicators.
 */
export async function fetchBlsEmploymentPilot(
  startYear: number,
  endYear: number
): Promise<BlsEmploymentPilotResult> {
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) {
    throw new Error("BLS employment pilot requires integer startYear and endYear.");
  }

  if (startYear > endYear) {
    throw new Error("BLS employment pilot startYear cannot be after endYear.");
  }

  const url = new URL(BLS_API_URL);
  url.searchParams.set(
    "seriesid",
    Object.values(BLS_EMPLOYMENT_SERIES).join(",")
  );
  url.searchParams.set("startyear", String(startYear));
  url.searchParams.set("endyear", String(endYear));

  const apiKey = process.env[BLS_API_KEY_ENV]?.trim();
  if (apiKey) {
    url.searchParams.set("registrationkey", apiKey);
  }

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`BLS employment API returned HTTP ${res.status}.`);
  }

  const data = (await res.json()) as BlsApiResponse;

  if (data.status !== "REQUEST_SUCCEEDED") {
    const message = data.message?.join(" ") || "Unknown BLS API error.";
    throw new Error(`BLS employment request failed: ${message}`);
  }

  const returnedSeries = data.Results?.series ?? [];
  const returnedIds = new Set(
    returnedSeries
      .map((series) => series.seriesID)
      .filter((id): id is string => Boolean(id))
  );

  for (const requiredId of Object.values(BLS_EMPLOYMENT_SERIES)) {
    if (!returnedIds.has(requiredId)) {
      throw new Error(
        `BLS employment series ${requiredId} was not returned by the API.`
      );
    }
  }

  const observations: BlsEmploymentObservation[] = [];

  for (const series of returnedSeries) {
    if (!series.seriesID || !isEmploymentSeries(series.seriesID)) {
      continue;
    }

    for (const item of series.data ?? []) {
      if (
        !item.year ||
        !/^M(0[1-9]|1[0-2])$/.test(item.period ?? "") ||
        item.value == null ||
        item.value === "."
      ) {
        continue;
      }

      const value = Number(item.value);
      if (!Number.isFinite(value)) {
        continue;
      }

      observations.push({
        seriesId: series.seriesID,
        year: item.year,
        period: item.period,
        periodName: item.periodName ?? "",
        value,
        footnotes: (item.footnotes ?? []).map((footnote) => ({
          code: footnote.code ?? null,
          text: footnote.text ?? null,
        })),
      });
    }
  }

  return {
    observations,
    retrievedAt: new Date().toISOString(),
  };
}

/** Convert a BLS monthly period to MUJIFX's YYYY-MM format. */
export function blsEmploymentPeriodToMonth(
  year: string,
  period: string
): string {
  const month = period.replace("M", "");
  return `${year}-${month}`;
}
