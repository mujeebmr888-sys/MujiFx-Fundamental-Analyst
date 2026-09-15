/**
 * STRICT BLS MONTHLY PUBLISHED-SNAPSHOT ROW PARSER
 *
 * Shared validation for BLS monthly published snapshots. It accepts only
 * already-parsed cells and never invents values, release dates, or vintages.
 */

export interface BlsMonthlySnapshotCell {
  observationDate: string;
  value: string | number | null | undefined;
}

export interface BlsMonthlySnapshotRow {
  observationDate: string;
  value: number;
  isMissing: boolean;
}

function assertMonth(value: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error(`BLS snapshot observationDate must be YYYY-MM: ${value}`);
  }
}

function parseValue(value: string | number | null | undefined, observationDate: string): number {
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
  } else if (typeof value === "string") {
    const normalized = value.trim().replace(/,/g, "");
    if (normalized && normalized !== "-") {
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  throw new Error(`BLS snapshot has an invalid value for ${observationDate}.`);
}

export function parseBlsMonthlySnapshotRows(
  cells: BlsMonthlySnapshotCell[]
): BlsMonthlySnapshotRow[] {
  if (!cells.length) {
    throw new Error("BLS snapshot contains no rows.");
  }

  const seen = new Set<string>();
  return cells.map((cell) => {
    const observationDate = cell.observationDate.trim();
    if (!observationDate) {
      throw new Error("BLS snapshot observationDate is required.");
    }
    assertMonth(observationDate);
    if (seen.has(observationDate)) {
      throw new Error(`Duplicate BLS observationDate: ${observationDate}`);
    }
    seen.add(observationDate);

    return {
      observationDate,
      value: parseValue(cell.value, observationDate),
      isMissing: false,
    };
  });
}
