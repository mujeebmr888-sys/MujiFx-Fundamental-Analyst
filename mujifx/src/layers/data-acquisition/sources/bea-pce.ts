/**
 * STEP 13J — BEA PCE SOURCE PILOT
 *
 * Isolated, read-only adapter for BEA NIPA Table 2.8.7.
 * It intentionally does NOT write to the production database.
 *
 * BEA's API requires a registered UserID/API key. The key is injected by
 * the caller and is never stored in source code or the database.
 */

const BEA_API_URL = "https://apps.bea.gov/api/data/";
const BEA_DATASET = "NIPA";
const BEA_TABLE = "T20807";

export const BEA_PCE_LINE_CODE = 1;
export const BEA_CORE_PCE_LINE_CODE = 25;

export interface BeaPceObservation {
  lineCode: number;
  lineDescription: string;
  timePeriod: string;
  value: number;
}

export interface BeaPcePilotResult {
  tableName: typeof BEA_TABLE;
  observations: BeaPceObservation[];
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

/**
 * Fetches monthly PCE and core PCE percent changes from BEA NIPA Table 2.8.7.
 *
 * The table is the official BEA monthly price-change table. PCE is line 1;
 * PCE excluding food and energy is line 25. The pilot returns observations
 * only and deliberately does not infer releaseDate from TimePeriod.
 */
export async function fetchBeaPcePilot(
  userId: string,
  years: string = "LAST5"
): Promise<BeaPcePilotResult> {
  if (!userId.trim()) {
    throw new Error("BEA PCE pilot requires a BEA UserID/API key.");
  }

  const url = new URL(BEA_API_URL);
  url.searchParams.set("UserID", userId);
  url.searchParams.set("method", "GETDATA");
  url.searchParams.set("datasetname", BEA_DATASET);
  url.searchParams.set("TableName", BEA_TABLE);
  url.searchParams.set(
    "LineCode",
    `${BEA_PCE_LINE_CODE},${BEA_CORE_PCE_LINE_CODE}`
  );
  url.searchParams.set("Frequency", "M");
  url.searchParams.set("Year", years);
  url.searchParams.set("ResultFormat", "JSON");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`BEA API returned HTTP ${res.status}.`);
  }

  const data = (await res.json()) as BeaApiResponse;
  const results = data.BEAAPI?.Results;

  if (results?.Error) {
    throw new Error(
      `BEA PCE request failed: ${results.Error.APIErrorCode ?? "unknown"} ${
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
        Number.isFinite(row.lineCode) && Number.isFinite(row.value)
    );

  return {
    tableName: BEA_TABLE,
    observations,
    retrievedAt: new Date().toISOString(),
  };
}
