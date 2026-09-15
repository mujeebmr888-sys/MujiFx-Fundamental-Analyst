import * as XLSX from "xlsx";
import type { BlsNfpSnapshotRow } from "@/layers/data-acquisition/sources/bls-nfp-vintage";

export const BLS_NFP_VINTAGE_URL =
  "https://www.bls.gov/web/empsit/cesvin00.xlsx";

export interface ParsedBlsNfpRelease {
  releaseDate: string;
  rows: BlsNfpSnapshotRow[];
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function monthNameToNumber(value: string): number | null {
  const names = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const normalized = value.trim().toLowerCase();
  const index = names.indexOf(normalized);
  if (index >= 0) return index + 1;
  const shortIndex = names.findIndex((name) => name.slice(0, 3) === normalized);
  return shortIndex >= 0 ? shortIndex + 1 : null;
}

function parseObservationMonth(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}`;
  }

  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text) return null;

  let match = /^(\d{4})[-\/]([0-1]\d)$/.exec(text);
  if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) {
    return `${match[1]}-${match[2]}`;
  }

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

  match = /^([A-Za-z]{3})[-\/]?(\d{2})$/.exec(text);
  if (match) {
    const month = monthNameToNumber(match[1]);
    if (month) {
      const year = Number(match[2]);
      return `${year >= 30 ? 1900 + year : 2000 + year}-${pad(month)}`;
    }
  }

  return null;
}

function parseReleaseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  const iso = parsed.toISOString().slice(0, 10);
  return /^20\d{2}-\d{2}-\d{2}$/.test(iso) ? iso : null;
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
  if (!sheet) {
    throw new Error("BLS CES vintage workbook is missing the Data sheet.");
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  if (matrix.length < 4) {
    throw new Error("BLS CES vintage Data sheet does not contain enough rows.");
  }

  const header = matrix[2] ?? [];
  const columns: Array<{ index: number; observationDate: string }> = [];
  for (let index = 1; index < header.length; index += 1) {
    const observationDate = parseObservationMonth(header[index]);
    if (observationDate) columns.push({ index, observationDate });
  }

  if (!columns.length) {
    throw new Error("BLS CES vintage Data sheet contains no recognizable observation-month columns.");
  }

  const releases = new Map<string, BlsNfpSnapshotRow[]>();

  for (let rowIndex = 3; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const releaseDate = parseReleaseDate(row[0]);
    if (!releaseDate) continue;

    const parsedRows: BlsNfpSnapshotRow[] = [];
    for (const column of columns) {
      const value = parseValue(row[column.index]);
      if (value === null) continue;
      parsedRows.push({
        observationDate: column.observationDate,
        releaseDate,
        value,
      });
    }

    if (parsedRows.length) releases.set(releaseDate, parsedRows);
  }

  const result = [...releases.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([releaseDate, rows]) => ({ releaseDate, rows }));

  if (!result.length) {
    throw new Error("BLS CES vintage Data sheet contains no release rows with numeric NFP observations.");
  }

  return result;
}
