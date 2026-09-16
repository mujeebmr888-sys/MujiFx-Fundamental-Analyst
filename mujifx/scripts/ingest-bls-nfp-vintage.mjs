import XLSX from "xlsx";

const BLS_URL = "https://www.bls.gov/web/empsit/cesvin00.xlsx";
const VERCEL_URL = process.env.VERCEL_VINTAGE_URL;
const SECRET = process.env.VERCEL_CRON_SECRET;
const MAX_ROWS = 5000;

if (!VERCEL_URL || !SECRET) {
  throw new Error("VERCEL_VINTAGE_URL and CRON_SECRET GitHub secret are required.");
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function monthNameToNumber(value) {
  const names = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const normalized = String(value).trim().toLowerCase();
  const index = names.indexOf(normalized);
  if (index >= 0) return index + 1;
  const shortIndex = names.findIndex((name) => name.slice(0, 3) === normalized);
  return shortIndex >= 0 ? shortIndex + 1 : null;
}

function parseObservationMonth(value) {
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

function parseReleaseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  const iso = parsed.toISOString().slice(0, 10);
  return /^20\d{2}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function parseValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized || normalized === "-" || normalized === "—") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseWorkbook(bytes) {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true, raw: true });
  const sheet = workbook.Sheets.Data;
  if (!sheet) throw new Error("BLS CES vintage workbook is missing the Data sheet.");

  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  if (matrix.length < 4) throw new Error("BLS CES vintage Data sheet is too short.");

  // BLS documents the reference-month headers on row 3, but the workbook can
  // contain merged/title rows that change the exact zero-based position after
  // XLSX parsing. Find the row containing the largest set of month headers.
  let headerRowIndex = -1;
  let columns = [];
  const scanLimit = Math.min(matrix.length, 20);

  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const candidateColumns = [];
    for (let index = 1; index < row.length; index += 1) {
      const observationDate = parseObservationMonth(row[index]);
      if (observationDate) candidateColumns.push({ index, observationDate });
    }
    if (candidateColumns.length > columns.length) {
      columns = candidateColumns;
      headerRowIndex = rowIndex;
    }
  }

  if (headerRowIndex < 0 || !columns.length) {
    throw new Error("No observation-month columns found in BLS vintage workbook.");
  }

  const releases = new Map();
  for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const releaseDate = parseReleaseDate(row[0]);
    if (!releaseDate) continue;

    const rows = [];
    for (const column of columns) {
      const value = parseValue(row[column.index]);
      if (value === null) continue;
      rows.push({ observationDate: column.observationDate, releaseDate, value });
    }
    if (rows.length) releases.set(releaseDate, rows);
  }

  return [...releases.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([releaseDate, rows]) => ({ releaseDate, rows }));
}

const response = await fetch(BLS_URL, {
  headers: {
    Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream;q=0.9, */*;q=0.1",
    "User-Agent": "MujiFx-Fundamental-Analyst/1.0 (BLS public-data ingestion)",
    Referer: "https://www.bls.gov/",
    "Accept-Encoding": "identity",
  },
});

if (!response.ok) {
  throw new Error(`BLS vintage download failed with HTTP ${response.status}.`);
}

const lastModified = response.headers.get("last-modified");
if (!lastModified) throw new Error("BLS vintage download did not provide Last-Modified provenance.");
const publication = new Date(lastModified);
if (Number.isNaN(publication.getTime())) throw new Error(`Invalid BLS Last-Modified: ${lastModified}`);
const publicationDate = publication.toISOString().slice(0, 10);

const bytes = Buffer.from(await response.arrayBuffer());
if (!bytes.length) throw new Error("BLS vintage download was empty.");

const releases = parseWorkbook(bytes);
const latest = releases.at(-1);
if (!latest) throw new Error("BLS vintage workbook contains no release rows.");
if (latest.rows.length > MAX_ROWS) throw new Error(`Latest release has ${latest.rows.length} rows.`);

const body = {
  kind: "NFP",
  snapshot: {
    snapshotUrl: BLS_URL,
    publicationDate,
    label: "BLS CES Total Nonfarm Vintage Data",
  },
  rows: latest.rows,
};

const publish = await fetch(VERCEL_URL, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${SECRET}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const text = await publish.text();
if (!publish.ok) {
  throw new Error(`Vercel vintage publish failed with HTTP ${publish.status}: ${text}`);
}

console.log(JSON.stringify({
  success: true,
  releaseDate: latest.releaseDate,
  publicationDate,
  rows: latest.rows.length,
  releasesAvailable: releases.length,
  publishResponse: text,
}, null, 2));
