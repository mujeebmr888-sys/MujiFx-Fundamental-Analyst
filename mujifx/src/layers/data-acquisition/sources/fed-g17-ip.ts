const FED_G17_IP_TEXT_URL = "https://www.federalreserve.gov/releases/g17/Current/ipdisk/ip_sa.txt";

export const FED_G17_IP_SERIES_ID = "G17/IP_MARKET_GROUPS/IP.B50001.S";

export interface FedG17IpObservation {
  period: string;
  value: number;
}

export interface FedG17IpResult {
  seriesId: string;
  observations: FedG17IpObservation[];
  retrievedAt: string;
}

function parseNumber(value: string): number | null {
  const normalized = value.trim();
  if (!normalized || normalized === "ND" || normalized === "NA") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchFedG17IndustrialProduction(
  startYear?: number,
  endYear?: number
): Promise<FedG17IpResult> {
  if (startYear !== undefined && (!Number.isInteger(startYear) || startYear < 1900)) {
    throw new Error("Federal Reserve G.17 IP startYear must be a valid integer year.");
  }
  if (endYear !== undefined && (!Number.isInteger(endYear) || endYear < 1900)) {
    throw new Error("Federal Reserve G.17 IP endYear must be a valid integer year.");
  }
  if (startYear !== undefined && endYear !== undefined && startYear > endYear) {
    throw new Error("Federal Reserve G.17 IP startYear cannot exceed endYear.");
  }

  const response = await fetch(FED_G17_IP_TEXT_URL, {
    headers: {
      Accept: "text/plain,*/*",
      "User-Agent": "MUJIFX Fundamental Analyst/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Federal Reserve G.17 IP request failed: HTTP ${response.status}`);
  }

  const text = await response.text();
  const observations: FedG17IpObservation[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("B50001:")) continue;

    const fields = line.split(/\s+/).map((field) => field.replace(/^\"|\"$/g, ""));
    if (fields.length < 14 || fields[0] !== "B50001") continue;

    const year = Number(fields[1]);
    if (!Number.isInteger(year)) continue;

    if (
      (startYear !== undefined && year < startYear) ||
      (endYear !== undefined && year > endYear)
    ) {
      continue;
    }

    for (let month = 1; month <= 12; month += 1) {
      const value = parseNumber(fields[month + 1] ?? "");
      if (value === null) continue;

      observations.push({
        period: `${year}-${String(month).padStart(2, "0")}`,
        value,
      });
    }
  }

  observations.sort((a, b) => a.period.localeCompare(b.period));

  if (observations.length === 0) {
    throw new Error("Federal Reserve G.17 Total IP series returned no usable observations.");
  }

  return {
    seriesId: FED_G17_IP_SERIES_ID,
    observations,
    retrievedAt: new Date().toISOString(),
  };
}
