```ts
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

interface CensusApiRow {
  dataTypeCode: string;
  timeSlotId: string;
  seasonallyAdjusted: string;
  categoryCode: string;
  cellValue: string;
  errorData: string;
}

function parseNumber(value: string): number | null {
  const normalized = value.trim();

  if (!normalized || normalized === "NA" || normalized === "(S)") {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readField(
  row: unknown[],
  headers: string[],
  field: string
): string | null {
  const index = headers.findIndex(
    (header) => header.toLowerCase() === field.toLowerCase()
  );

  if (index < 0) return null;

  const value = row[index];

  return typeof value === "string" ? value : null;
}

async function fetchCensusYear(
  year: number,
  apiKey: string
): Promise<CensusApiRow[]> {
  const params = new URLSearchParams({
    get: "cell_value,data_type_code,time_slot_id,error_data,category_code,seasonally_adj",
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
    throw new Error(
      `U.S. Census MRTS API returned no usable rows for ${year}.`
    );
  }

  const headerRow = payload[0];

  if (
    !Array.isArray(headerRow) ||
    !headerRow.every((value) => typeof value === "string")
  ) {
    throw new Error(
      `U.S. Census MRTS API returned an invalid header row for ${year}.`
    );
  }

  const headers = headerRow as string[];
  const rows = payload.slice(1) as unknown[];

  const parsedRows: CensusApiRow[] = [];

  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    const dataTypeCode = readField(row, headers, "data_type_code");
    const timeSlotId = readField(row, headers, "time_slot_id");
    const seasonallyAdjusted = readField(row, headers, "seasonally_adj");
    const categoryCode = readField(row, headers, "category_code");
    const cellValue = readField(row, headers, "cell_value");
    const errorData = readField(row, headers, "error_data");

    if (
      dataTypeCode === null ||
      timeSlotId === null ||
      seasonallyAdjusted === null ||
      categoryCode === null ||
      cellValue === null ||
      errorData === null
    ) {
      continue;
    }

    parsedRows.push({
      dataTypeCode,
      timeSlotId,
      seasonallyAdjusted,
      categoryCode,
      cellValue,
      errorData,
    });
  }

  return parsedRows;
}

export async function fetchCensusRetailSales(
  startYear?: number,
  endYear?: number
): Promise<CensusRetailSalesResult> {
  if (
    startYear !== undefined &&
    (!Number.isInteger(startYear) || startYear < 1992)
  ) {
    throw new Error(
      "Census retail sales startYear must be a valid integer year."
    );
  }

  if (
    endYear !== undefined &&
    (!Number.isInteger(endYear) || endYear < 1992)
  ) {
    throw new Error(
      "Census retail sales endYear must be a valid integer year."
    );
  }

  if (
    startYear !== undefined &&
    endYear !== undefined &&
    startYear > endYear
  ) {
    throw new Error(
      "Census retail sales startYear cannot exceed endYear."
    );
  }

  const apiKey = process.env.CENSUS_API_KEY;

  if (!apiKey) {
    throw new Error("CENSUS_API_KEY is not configured on the server.");
  }

  const resolvedStartYear =
    startYear ?? new Date().getUTCFullYear();

  const resolvedEndYear =
    endYear ?? resolvedStartYear;

  const observations: CensusRetailSalesObservation[] = [];

  for (
    let year = resolvedStartYear;
    year <= resolvedEndYear;
    year += 1
  ) {
    const rows = await fetchCensusYear(year, apiKey);

    for (const row of rows) {
      const value = parseNumber(row.cellValue);

      if (
        row.seasonallyAdjusted.toLowerCase() !== "yes" ||
        row.categoryCode !== CENSUS_MRTS_CATEGORY_CODE ||
        row.dataTypeCode !== CENSUS_MRTS_DATA_TYPE_CODE ||
        value === null
      ) {
        continue;
      }

      const month = Number(row.timeSlotId);

      if (
        !Number.isInteger(month) ||
        month < 1 ||
        month > 12
      ) {
        continue;
      }

      observations.push({
        period: `${year}-${String(month).padStart(2, "0")}`,
        value,
      });
    }
  }

  const uniqueObservations = Array.from(
    new Map(
      observations.map((item) => [item.period, item])
    ).values()
  ).sort((a, b) =>
    a.period.localeCompare(b.period)
  );

  if (uniqueObservations.length === 0) {
    throw new Error(
      "U.S. Census MRTS returned no usable seasonally adjusted retail sales observations."
    );
  }

  return {
    seriesId: CENSUS_MRTS_SERIES_ID,
    observations: uniqueObservations,
    retrievedAt: new Date().toISOString(),
  };
}
```
