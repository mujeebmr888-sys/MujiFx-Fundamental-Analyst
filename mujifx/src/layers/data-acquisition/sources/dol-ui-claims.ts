const DOL_UI_CLAIMS_URL = "https://oui.doleta.gov/unemploy/csv/ar539.csv";

export interface DolUiClaimObservation {
  weekEnded: string;
  reflectingWeekEnded: string | null;
  initialClaims: number;
  continuedClaims: number;
}

export interface DolUiClaimsResult {
  observations: DolUiClaimObservation[];
  retrievedAt: string;
}

function parseNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const normalized = value.replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();

  const mdy = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }

  const ymd = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }

  return null;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

export async function fetchDolUiClaims(startYear: number, endYear: number): Promise<DolUiClaimsResult> {
  const response = await fetch(DOL_UI_CLAIMS_URL, {
    method: "GET",
    headers: {
      Accept: "text/csv,text/plain,*/*",
      "User-Agent": "MUJIFX Fundamental Analyst/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`DOL ETA 539 CSV request failed with HTTP ${response.status}.`);
  }

  const csv = await response.text();
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("DOL ETA 539 CSV response contained no data rows.");
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const indexOf = (name: string): number => headers.indexOf(name.toLowerCase());

  const stateIndex = indexOf("st");
  const reportDateIndex = indexOf("rptdate");
  const reflectingDateIndex = indexOf("c2");
  const initialUiIndex = indexOf("c3");
  const initialFederalIndex = indexOf("c4");
  const continuedUiIndex = indexOf("c8");
  const continuedFederalIndex = indexOf("c9");

  const requiredIndexes = [
    stateIndex,
    reportDateIndex,
    reflectingDateIndex,
    initialUiIndex,
    initialFederalIndex,
    continuedUiIndex,
    continuedFederalIndex,
  ];

  if (requiredIndexes.some((index) => index < 0)) {
    throw new Error(
      "DOL ETA 539 CSV is missing one or more required fields: st, rptdate, c2, c3, c4, c8, c9."
    );
  }

  const startDate = `${startYear}-01-01`;
  const endDate = `${endYear}-12-31`;
  const grouped = new Map<
    string,
    { weekEnded: string; reflectingWeekEnded: string | null; initialClaims: number; continuedClaims: number }
  >();

  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    if (row.length <= Math.max(...requiredIndexes)) continue;

    const state = row[stateIndex].trim();
    const weekEnded = parseDate(row[reportDateIndex]);
    const reflectingWeekEnded = parseDate(row[reflectingDateIndex]);

    if (!state || !weekEnded || weekEnded < startDate || weekEnded > endDate) continue;

    const initialUi = parseNumber(row[initialUiIndex]);
    const initialFederal = parseNumber(row[initialFederalIndex]);
    const continuedUi = parseNumber(row[continuedUiIndex]);
    const continuedFederal = parseNumber(row[continuedFederalIndex]);

    if (
      initialUi === null ||
      initialFederal === null ||
      continuedUi === null ||
      continuedFederal === null
    ) {
      continue;
    }

    const existing = grouped.get(weekEnded) ?? {
      weekEnded,
      reflectingWeekEnded,
      initialClaims: 0,
      continuedClaims: 0,
    };

    existing.initialClaims += initialUi + initialFederal;
    existing.continuedClaims += continuedUi + continuedFederal;

    if (!existing.reflectingWeekEnded && reflectingWeekEnded) {
      existing.reflectingWeekEnded = reflectingWeekEnded;
    }

    grouped.set(weekEnded, existing);
  }

  const observations = [...grouped.values()].sort((a, b) =>
    a.weekEnded.localeCompare(b.weekEnded)
  );

  if (observations.length === 0) {
    throw new Error("DOL ETA 539 CSV contained no usable national weekly observations in the requested range.");
  }

  return {
    observations,
    retrievedAt: new Date().toISOString(),
  };
}

export { DOL_UI_CLAIMS_URL };
