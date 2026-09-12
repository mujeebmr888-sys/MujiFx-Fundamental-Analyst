const CENSUS_MRTS_TOTAL_ADJUSTED_URL =
  "https://www.census.gov/retail/marts/www/adv44X72.txt";

export const CENSUS_MRTS_CATEGORY_CODE = "44X72";
export const CENSUS_MRTS_SERIES_ID = "MRTS/44X72/SALES_MONTHLY_ADJUSTED";

export interface CensusRetailSalesObservation {
  period: string;
  value: number;
}

export interface CensusRetailSalesResult {
  seriesId: string;
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

  const response = await fetch(CENSUS_MRTS_TOTAL_ADJUSTED_URL, {
    headers: {
      Accept: "text/plain,*/*",
      "User-Agent": "MUJIFX Fundamental Analyst/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`U.S. Census MRTS request failed: HTTP ${response.status}`);
  }

  const text = await response.text();
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const headerIndex = lines.findIndex((line) =>
    /^YEAR\s+JAN\s+FEB\s+MAR\s+APR\s+MAY\s+JUN\s+JUL\s+AUG\s+SEP\s+OCT\s+NOV\s+DEC$/i.test(line)
  );

  if (headerIndex < 0) {
    throw new Error("U.S. Census MRTS response is missing the monthly sales header.");
  }

  const observations: CensusRetailSalesObservation[] = [];

  for (const line of lines.slice(headerIndex + 1)) {
    if (!line || /^SEASONAL FACTORS$/i.test(line)) break;

    const fields = line.split(/\s+/);
    if (fields.length !== 13 || !/^\d{4}$/.test(fields[0])) continue;

    const year = Number(fields[0]);
    if (
      (startYear !== undefined && year < startYear) ||
      (endYear !== undefined && year > endYear)
    ) {
      continue;
    }

    for (let month = 1; month <= 12; month += 1) {
      const value = parseNumber(fields[month]);
      if (value === null) continue;

      observations.push({
        period: `${year}-${String(month).padStart(2, "0")}`,
        value,
      });
    }
  }

  if (observations.length === 0) {
    throw new Error("U.S. Census MRTS total retail sales returned no usable observations.");
  }

  observations.sort((a, b) => a.period.localeCompare(b.period));

  return {
    seriesId: CENSUS_MRTS_SERIES_ID,
    observations,
    retrievedAt: new Date().toISOString(),
  };
}
