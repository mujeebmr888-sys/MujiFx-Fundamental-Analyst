const CENSUS_MRTS_API_URL = "https://api.census.gov/data/timeseries/eits/mrts";

export const CENSUS_MRTS_DATASET = "timeseries/eits/mrts";
export const CENSUS_MRTS_CATEGORY_CODE = "44X72";

export interface CensusRetailSalesObservation {
  period: string;
  value: number;
}

export interface CensusRetailSalesResult {
  dataset: string;
  categoryCode: string;
  observations: CensusRetailSalesObservation[];
  retrievedAt: string;
}

function parseNumber(value: string): number | null {
  const normalized = value.trim();
  if (!normalized || normalized === "NA" || normalized === "(S)") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
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
    throw new Error("Missing CENSUS_API_KEY environment variable.");
  }

  const params = new URLSearchParams({
    get: "data_type_code,time_slot_id,seasonally_adj,category_code,cell_value,error_data",
    category_code: CENSUS_MRTS_CATEGORY_CODE,
    data_type_code: "SM",
    seasonally_adj: "yes",
    key: apiKey,
  });

  if (startYear !== undefined && endYear !== undefined) {
    params.set("time", `${startYear}-${String(endYear).padStart(4, "0")}`);
  } else if (endYear !== undefined) {
    params.set("time", String(endYear));
  }

  const response = await fetch(`${CENSUS_MRTS_API_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MUJIFX Fundamental Analyst/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`U.S. Census MRTS request failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as string[][];
  if (!Array.isArray(payload) || payload.length < 2) {
    throw new Error("U.S. Census MRTS returned no usable rows.");
  }

  const headers = payload[0];
  const index = (name: string) => headers.indexOf(name);
  const dataTypeIndex = index("data_type_code");
  const timeSlotIndex = index("time_slot_id");
  const seasonalIndex = index("seasonally_adj");
  const categoryIndex = index("category_code");
  const valueIndex = index("cell_value");
  const errorIndex = index("error_data");

  const requiredIndexes = [
    dataTypeIndex,
    timeSlotIndex,
    seasonalIndex,
    categoryIndex,
    valueIndex,
    errorIndex,
  ];
  if (requiredIndexes.some((value) => value < 0)) {
    throw new Error("U.S. Census MRTS response is missing expected fields.");
  }

  const observations: CensusRetailSalesObservation[] = [];

  for (const row of payload.slice(1)) {
    if (row[dataTypeIndex] !== "SM") continue;
    if (row[seasonalIndex]?.toLowerCase() !== "yes") continue;
    if (row[categoryIndex] !== CENSUS_MRTS_CATEGORY_CODE) continue;
    if (row[errorIndex] === "NA" || row[errorIndex] === "(S)") continue;

    const value = parseNumber(row[valueIndex] ?? "");
    if (value === null) continue;

    const timeSlot = row[timeSlotIndex]?.trim() ?? "";
    const match = timeSlot.match(/^(\d{4})-(\d{2})$/);
    if (!match) continue;

    const year = Number(match[1]);
    if (
      (startYear !== undefined && year < startYear) ||
      (endYear !== undefined && year > endYear)
    ) {
      continue;
    }

    observations.push({ period: timeSlot, value });
  }

  const deduped = new Map<string, CensusRetailSalesObservation>();
  for (const observation of observations) {
    deduped.set(observation.period, observation);
  }

  const sorted = Array.from(deduped.values()).sort((a, b) =>
    a.period.localeCompare(b.period)
  );

  if (sorted.length === 0) {
    throw new Error("U.S. Census MRTS total retail sales returned no usable observations.");
  }

  return {
    dataset: CENSUS_MRTS_DATASET,
    categoryCode: CENSUS_MRTS_CATEGORY_CODE,
    observations: sorted,
    retrievedAt: new Date().toISOString(),
  };
}
