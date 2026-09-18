import * as XLSX from "xlsx";
import type { BlsNfpSnapshotRow } from "@/layers/data-acquisition/sources/bls-nfp-vintage";

export const BLS_NFP_VINTAGE_URL = "https://www.bls.gov/web/empsit/cesvin00.xlsx";

export interface ParsedBlsNfpRelease {
  releasePeriod: string;
  rows: BlsNfpSnapshotRow[];
}

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

function pad(value: number): string { return String(value).padStart(2, "0"); }

function monthNameToNumber(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  const index = MONTHS.indexOf(normalized);
  if (index >= 0) return index + 1;
  const shortIndex = MONTHS.findIndex((name) => name.slice(0, 3) === normalized.slice(0, 3));
  return shortIndex >= 0 ? shortIndex + 1 : null;
}

function excelDate(value: number): Date | null {
  if (!Number.isFinite(value) || value < 1 || value > 100000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
}

function parseObservationMonth(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}`;
  if (typeof value === "number") {
    const date = excelDate(value);
    return date ? `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}` : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();

  let match = /^(\d{4})[-\/]([0-1]\d)$/.exec(text);
  if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) return `${match[1]}-${match[2]}`;
  match = /^([A-Za-z]+)[\s\/-]+(\d{4})$/.exec(text);
  if (match) {
    const month = monthNameToNumber(match[1]);
    if (month) return `${match[2]}-${pad(month)}`;
  }
  match = /^(\d{4})[\s\/-]+([A-Za-z]+)$/.exec(text);
  if (match) {
    const month = monthNameToNumber(match[2]);
    if (month) return `${match[1]}-${pad(month)}`;
  }
  return null;
}

function parseReleasePeriod(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}`;
  if (typeof value === "string") {
    const text = value.trim();
    let match = /^([A-Za-z]+)[\s\/-]+(\d{4})/.exec(text);
    if (match) {
      const month = monthNameToNumber(match[1]);
      if (month) return `${match[2]}-${pad(month)}`;
    }
    match = /^(\d{4})[\s\/-]+([A-Za-z]+)/.exec(text);
    if (match) {
      const month = monthNameToNumber(match[2]);
      if (month) return `${match[1]}-${pad(month)}`;
    }
  }
  if (typeof value === "number") {
    const date = excelDate(value);
    return date ? `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}` : null;
  }
  return null;
}

function parseValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized || normalized === "-" || normalized === "—") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseBlsNfpVintageWorkbook(data: ArrayBuffer): ParsedBlsNfpRelease[] {
  const workbook = XLSX.read(data, { type: "array", cellDates: true, raw: true });
  const sheet = workbook.Sheets.Data;
  if (!sheet) throw new Error("BLS CES vintage workbook is missing the Data sheet.");

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  if (matrix.length < 4) throw new Error("BLS CES vintage Data sheet does not contain enough rows.");

  // Official BLS layout: column A identifies the Employment Situation release;
  // columns B+ are reference months. The vintage value is at the intersection.
  let headerRow = -1;
  let observationColumns: Array<{ index: number; observationDate: string }> = [];

  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 10); rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const candidate: Array<{ index: number; observationDate: string }> = [];
    for (let index = 1; index < row.length; index += 1) {
      const observationDate = parseObservationMonth(row[index]);
      if (observationDate) candidate.push({ index, observationDate });
    }
    if (candidate.length > observationColumns.length) {
      // BLS publishes both employment levels and over-the-month changes in
      // this workbook. Both sections reuse the same reference-month headers.
      // Keep the first occurrence of each month: the Total Nonfarm level.
      const seenMonths = new Set<string>();
      observationColumns = candidate.filter((column) => {
        if (seenMonths.has(column.observationDate)) return false;
        seenMonths.add(column.observationDate);
        return true;
      });
      headerRow = rowIndex;
    }
  }

  if (headerRow < 0 || !observationColumns.length) {
    throw new Error("BLS CES vintage Data sheet contains no recognizable reference-month columns.");
  }

  const releases = new Map<string, BlsNfpSnapshotRow[]>();

  for (let rowIndex = headerRow + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const releasePeriod = parseReleasePeriod(row[0]);
    if (!releasePeriod) continue;

    for (const column of observationColumns) {
      const value = parseValue(row[column.index]);
      if (value === null) continue;

      const rows = releases.get(releasePeriod) ?? [];
      rows.push({
        observationDate: column.observationDate,
        releaseDate: releasePeriod,
        value,
      });
      releases.set(releasePeriod, rows);
    }
  }

  const result = [...releases.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([releasePeriod, rows]) => ({ releasePeriod, rows }));

  if (!result.length) throw new Error("BLS CES vintage Data sheet contains no release snapshots with numeric NFP observations.");
  return result;
}
