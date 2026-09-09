/**
 * STEP 13J — BEA GDP GROWTH SOURCE PILOT
 *
 * Isolated, read-only adapter for BEA NIPA Table 1.1.1.
 * It intentionally does NOT write to the production database.
 *
 * BEA's API requires a registered UserID/API key. In production the key is
 * read server-side from the Vercel environment variable named BEA.
 */

const BEA_API_URL = "https://apps.bea.gov/api/data/";
const BEA_DATASET = "NIPA";
const BEA_TABLE = "T10101";
const BEA_API_KEY_ENV = "BEA";

export const BEA_GDP_GROWTH_LINE_CODE = 1;

export interface BeaGdpGrowthObservation {
  lineCode: number;
  lineDescription: string;
  timePeriod: string;
  value: number;
}

export interface BeaGdpGrowthPilotResult {
  tableName: typeof BEA_TABLE;
  observations: BeaGdpGrowthObservation[];
  retrievedAt: string;
}

interface BeaApiRow {
  LineNumber?: string;
  LineDescription?: string;
  TimePeriod?: string;
  CL_UNIT?: string;
  DataValue?: string;
}

interface BeaApiResponse {
  BEAAPI?: {
    Results?: {
      Error?: {
        APIErrorCode?: string;
        APIErrorDescription?: string;
      };
      Data?: BeaApiRow[];
    };
  };
}

function resolveBeaUserId(userId?: string): string {
  const configured = userId?.trim() || process.env[BEA_API_KEY_ENV]?.trim();
  if (!configured) {
    throw new Error(
      `BEA GDP growth pilot requires a BEA UserID/API key. Configure the Vercel environment variable ${BEA_API_KEY_ENV}.`
    );
  }
  return configured;
}

/**
 * Fetches quarterly real GDP percent change from the preceding period.
 *
 * BEA NIPA Table 1.1.1 reports real GDP growth at seasonally adjusted
 * annual rates. MUJIFX stores the BEA published rate as-is and does not
 * re-annualize or transform it.
 */
export async function fetchBeaGdpGrowthPilot(
  userId?: string,
  years: string = "LAST5"
): Promise<BeaGdpGrowthPilotResult> {
  const resolvedUserId = resolveBeaUserId(userId);

  const url = new URL(BEA_API_URL);
  url.searchParams.set("UserID", resolvedUserId);
  url.searchParams.set("method", "GETDATA");
  url.searchParams.set("datasetname", BEA_DATASET);
  url.searchParams.set("TableName", BEA_TABLE);
  url.searchParams.set("LineCode", String(BEA_GDP_GROWTH_LINE_CODE));
  url.searchParams.set("Frequency", "Q");
  url.searchParams.set("Year", years);
  url.searchParams.set("ResultFormat", "JSON");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`BEA GDP growth API returned HTTP ${res.status}.`);
  }

  const data = (await res.json()) as BeaApiResponse;
  const results = data.BEAAPI?.Results;

  if (results?.Error) {
    throw new Error(
      `BEA GDP growth request failed: ${results.Error.APIErrorCode ?? "unknown"} ${
        results.Error.APIErrorDescription ?? "Unknown BEA API error."
      }`
    );
  }

  const observations = (results?.Data ?? [])
    .filter(
      (row) =>
        row.LineNumber &&
        row.TimePeriod &&
        row.DataValue != null &&
        row.DataValue !== "..."
    )
    .map((row) => ({
      lineCode: Number(row.LineNumber),
      lineDescription: row.LineDescription ?? "",
      timePeriod: row.TimePeriod as string,
      value: Number(String(row.DataValue).replace(/,/g, "")),
    }))
    .filter(
      (row) =>
        row.lineCode === BEA_GDP_GROWTH_LINE_CODE && Number.isFinite(row.value)
    );

  return {
    tableName: BEA_TABLE,
    observations,
    retrievedAt: new Date().toISOString(),
  };
}
