// Historical BLS CES Total Nonfarm vintage backfill.
// The BLS CES vintage workbook is column-oriented: release dates are the
// column headers and observation months are the first column.
// Source: https://www.bls.gov/web/empsit/cesvin00.xlsx

import XLSX from "xlsx";

const BLS_URL = "https://www.bls.gov/web/empsit/cesvin00.xlsx";
const VERCEL_URL = process.env.VERCEL_VINTAGE_URL;
const SECRET = process.env.VERCEL_CRON_SECRET;
const MAX_ROWS_PER_REQUEST = 2500;
const FIRST_RELEASE_YEAR = 2003;

if (!VERCEL_URL || !SECRET) throw new Error("VERCEL_VINTAGE_URL and VERCEL_CRON_SECRET are required.");

const pad = (value) => String(value).padStart(2, "0");
const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];

function monthNumber(value) {
  const text = String(value).trim().toLowerCase();
  const full = months.indexOf(text);
  if (full >= 0) return full + 1;
  const short = months.findIndex((month) => month.slice(0, 3) === text.slice(0, 3));
  return short >= 0 ? short + 1 : null;
}

function excelDate(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 100000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
}

function parseObservationMonth(value) {
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
    const month = monthNumber(match[1]);
    if (month) return `${match[2]}-${pad(month)}`;
  }
  match = /^(\d{4})[\s\/-]+([A-Za-z]+)$/.exec(text);
  if (match) {
    const month = monthNumber(match[2]);
    if (month) return `${match[1]}-${pad(month)}`;
  }
  match = /^([A-Za-z]{3,9})[-\/]?(\d{2})$/.exec(text);
  if (match) {
    const month = monthNumber(match[1]);
    if (month) {
      const year = Number(match[2]);
      return `${year >= 30 ? 1900 + year : 2000 + year}-${pad(month)}`;
    }
  }
  return null;
}

function parseReleaseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const date = excelDate(value);
    return date ? date.toISOString().slice(0, 10) : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  const match = /^(?:[A-Za-z]+,?\s+)?([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(text);
  if (match) {
    const month = monthNumber(match[1]);
    if (month) {
      const date = new Date(Date.UTC(Number(match[3]), month - 1, Number(match[2])));
      if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  const iso = parsed.toISOString().slice(0, 10);
  return /^20\d{2}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function numeric(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value ?? "").trim().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseWorkbook(bytes) {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true, raw: true });
  const sheet = workbook.Sheets.Data;
  if (!sheet) throw new Error("BLS vintage workbook is missing the Data sheet.");

  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  if (matrix.length < 4) throw new Error("BLS vintage Data sheet does not contain enough rows.");

  let releaseHeaderRowIndex = -1;
  let releaseColumns = [];

  // Release dates are in the header row; observation months are in column A.
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 10); rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const candidate = [];
    for (let index = 1; index < row.length; index += 1) {
      const releaseDate = parseReleaseDate(row[index]);
      if (releaseDate) candidate.push({ index, releaseDate });
    }
    if (candidate.length > releaseColumns.length) {
      releaseColumns = candidate;
      releaseHeaderRowIndex = rowIndex;
    }
  }

  if (releaseHeaderRowIndex < 0 || !releaseColumns.length) {
    throw new Error("No release-date columns found in BLS vintage workbook.");
  }

  const releases = new Map();

  for (let rowIndex = releaseHeaderRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const observationDate = parseObservationMonth(row[0]);
    if (!observationDate) continue;

    for (const column of releaseColumns) {
      const value = numeric(row[column.index]);
      if (value === null) continue;

      const rows = releases.get(column.releaseDate) ?? [];
      rows.push({ observationDate, value, releaseDate: column.releaseDate });
      releases.set(column.releaseDate, rows);
    }
  }

  return [...releases.entries()]
    .filter(([releaseDate]) => Number(releaseDate.slice(0, 4)) >= FIRST_RELEASE_YEAR)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([releaseDate, rows]) => ({ releaseDate, rows }));
}

async function publish(rows, releaseDate, publicationDate) {
  const response = await fetch(VERCEL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "NFP",
      snapshot: {
        snapshotUrl: BLS_URL,
        publicationDate,
        label: "BLS CES Total Nonfarm Vintage Data",
      },
      rows,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) throw new Error(`Release ${releaseDate} failed: HTTP ${response.status}: ${responseText}`);
  return JSON.parse(responseText);
}

const response = await fetch(BLS_URL, {
  headers: {
    Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream;q=0.9, */*;q=0.1",
    "User-Agent": "MujiFx-Fundamental-Analyst/1.0 (BLS public-data ingestion)",
    Referer: "https://www.bls.gov/",
    "Accept-Encoding": "identity",
  },
});
if (!response.ok) throw new Error(`BLS vintage download failed with HTTP ${response.status}.`);

const lastModified = response.headers.get("last-modified");
if (!lastModified) throw new Error("BLS vintage download did not provide Last-Modified provenance.");

const publication = new Date(lastModified);
if (Number.isNaN(publication.getTime())) throw new Error(`Invalid BLS Last-Modified: ${lastModified}`);

const publicationDate = publication.toISOString().slice(0, 10);
const bytes = Buffer.from(await response.arrayBuffer());
if (!bytes.length) throw new Error("BLS vintage download was empty.");

const releases = parseWorkbook(bytes);
if (!releases.length) throw new Error("No eligible BLS NFP vintage releases found.");

let totalRows = 0;
let requests = 0;

for (const release of releases) {
  for (let start = 0; start < release.rows.length; start += MAX_ROWS_PER_REQUEST) {
    const chunk = release.rows.slice(start, start + MAX_ROWS_PER_REQUEST);
    await publish(chunk, release.releaseDate, publicationDate);
    requests += 1;
    totalRows += chunk.length;
  }
  console.log(JSON.stringify({ releaseDate: release.releaseDate, rows: release.rows.length, requests, totalRows }));
}

console.log(JSON.stringify({
  success: true,
  mode: "historical-backfill",
  publicationDate,
  eligibleReleases: releases.length,
  requests,
  totalRows,
}, null, 2));
