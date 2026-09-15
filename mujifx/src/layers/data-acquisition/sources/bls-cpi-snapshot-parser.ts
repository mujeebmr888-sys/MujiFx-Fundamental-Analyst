/**
 * STRICT BLS PUBLISHED-SNAPSHOT ROW PARSER
 *
 * Converts already-parsed tabular snapshot cells into the canonical monthly
 * rows expected by the authoritative vintage adapters. It intentionally does
 * not download files and never invents release dates or values.
 */

import type { BlsCpiSnapshotRow } from "@/layers/data-acquisition/sources/bls-cpi-vintage";

export interface BlsCpiSnapshotCell {
  observationDate: string;
  value: string | number | null | undefined;
}

function assertMonth(value: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error(`BLS CPI snapshot observationDate must be YYYY-MM: ${value}`);
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

  throw new Error(`BLS CPI snapshot has an invalid value for ${observationDate}.`);
}

export function parseBlsCpiSnapshotRows(
  cells: BlsCpiSnapshotCell[]
): BlsCpiSnapshotRow[] {
  if (!cells.length) {
    throw new Error("BLS CPI snapshot contains no rows.");
  }

  const seen = new Set<string>();
  return cells.map((cell) => {
    if (!cell.observationDate.trim()) {
      throw new Error("BLS CPI snapshot observationDate is required.");
    }
    assertMonth(cell.observationDate);
    if (seen.has(cell.observationDate)) {
      throw new Error(`Duplicate BLS CPI observationDate: ${cell.observationDate}`);
    }
    seen.add(cell.observationDate);

    return {
      observationDate: cell.observationDate,
      value: parseValue(cell.value, cell.observationDate),
      isMissing: false,
    };
  });
}
