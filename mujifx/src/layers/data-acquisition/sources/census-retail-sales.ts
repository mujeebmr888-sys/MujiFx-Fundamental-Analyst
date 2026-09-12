const CENSUS_MRTS_API_URL =
  "https://api.census.gov/data/timeseries/eits/mrts";

export const CENSUS_MRTS_CATEGORY_CODE = "44X72";
export const CENSUS_MRTS_DATA_TYPE_CODE = "SM";
export const CENSUS_MRTS_SERIES_ID = "MRTS/44X72/SM/SEASONALLY_ADJUSTED";

export interface CensusRetailSalesObservation {
  period: string;
  value: number;
}

export interface CensusRetailSalesResult {
  seriesId: string;
  observations: CensusRetailSalesObservation[];
  retrievedAt: string;
}

type CensusApiRow = [string, string, string, string, string, string];

function parseNumber(value: string): number | null {
  const normalized = value.trim();
  if (!normalized || normalized === "NA" || normalized === "(S)") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchCensusYear(year: number, apiKey: string): Promise<CensusApiRow[]> {
  const params = new URLSearchParams({
    get: "data_type_code,time_slot_id,seasonally_adj,category_code,cell_value,error_data",
    category_code: CENSUS_MRTS_CATEGORY_CODE,
    data_type_code: CENSUS_MRTS_DATA_TYPE_CODE,
    seasonally_adj: "yes",
    time: String(year),
    key: apiKey,
  });

  const response = await fetch(`${CENSUS_MRTS_API_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MUJIFX Fundamental Analyst/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `U.S. Census MRTS API request failed for ${year}: HTTP ${response.status}${
        body ? ` - ${body.slice(0, 300)}` : ""
      }`
    );
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || payload.length < 2) {
    throw new Error(`U.S. Census MRTS API returned no usable rows for ${year}.`);
  }

  const rows = payload.slice(1) as unknown[];
  return rows.filter(
    (row): row is CensusApiRow =>
      Array.isArray(row) && row.length >= 6 && row.every((value) => typeof value === "string")
  );
}

export async function fetchCensusRetailSales(
  startYear?: number,
  endYear?: number
): Promise<CensusRetailSalesResult> {
  if (startYear !== undefined && (!Number.isInteger(startYear) || startYear < 1992)) {
    throw new Error("Census retail sales startYear must be a valid integer year.");
  }
  if (endYear !== undefined && (!Number.isInteger(endYear) || endYear < 1992)) {
    throw new Error("Census retail sales endYear must be a valid integer year.");
  }
  if (startYear !== undefined && endYear !== undefined && startYear > endYear) {
    throw new Error("Census retail sales startYear cannot exceed endYear.");
  }

  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) {
    throw new Error("CENSUS_API_KEY is not configured on the server.");
  }

  const resolvedStartYear = startYear ?? new Date().getUTCFullYear();
  const resolvedEndYear = endYear ?? resolvedStartYear;
  const observations: CensusRetailSalesObservation[] = [];

  for (let year = resolvedStartYear; year <= resolvedEndYear; year += 1) {
    const rows = await fetchCensusYear(year, apiKey);

    for (const row of rows) {
      const [, timeSlotId, seasonallyAdjusted, categoryCode, cellValue] = row;
      const value = parseNumber(cellValue);

      if (
        seasonallyAdjusted.toLowerCase() !== "yes" ||
        categoryCode !== CENSUS_MRTS_CATEGORY_CODE ||
        value === null
      ) {
        continue;
      }

      const month = Number(timeSlotId);
      if (!Number.isInteger(month) || month < 1 || month > 12) continue;

      observations.push({
        period: `${year}-${String(month).padStart(2, "0")}`,
        value,
      });
    }
  }

  const uniqueObservations = Array.from(
    new Map(observations.map((item) => [item.period, item])).values()
  ).sort((a, b) => a.period.localeCompare(b.period));

  if (uniqueObservations.length === 0) {
    throw new Error("U.S. Census MRTS returned no usable seasonally adjusted retail sales observations.");
  }

  return {
    seriesId: CENSUS_MRTS_SERIES_ID,
    observations: uniqueObservations,
    retrievedAt: new Date().toISOString(),
  };
}
