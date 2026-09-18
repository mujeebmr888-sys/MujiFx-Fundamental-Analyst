// Historical BLS CES Total Nonfarm vintage backfill.
// Official BLS vintage layout: rows are Employment Situation releases and
// columns are reference months. Release publication dates are resolved from
// the official BLS annual release schedules.
// Source: https://www.bls.gov/web/empsit/cesvin00.xlsx

import XLSX from "xlsx";

const BLS_URL = "https://www.bls.gov/web/empsit/cesvin00.xlsx";
const BLS_SCHEDULE_BASE = "https://www.bls.gov/schedule";
const VERCEL_URL = process.env.VERCEL_VINTAGE_URL;
const SECRET = process.env.VERCEL_CRON_SECRET;
const MAX_ROWS_PER_REQUEST = 2500;
const FIRST_RELEASE_PERIOD = "2003-05";

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
  return null;
}

function parseReleasePeriod(value) {
  if (typeof value === "string") {
    const text = value.trim();
    let match = /^([A-Za-z]+)[\s\/-]+(\d{4})/.exec(text);
    if (match) {
      const month = monthNumber(match[1]);
      if (month) return `${match[2]}-${pad(month)}`;
    }
    match = /^(\d{4})[\s\/-]+([A-Za-z]+)/.exec(text);
    if (match) {
      const month = monthNumber(match[2]);
      if (month) return `${match[1]}-${pad(month)}`;
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}`;
  if (typeof value === "number") {
    const date = excelDate(value);
    return date ? `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}` : null;
  }
  return null;
}

function numeric(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value ?? "").trim().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseScheduleDate(text, year) {
  const match = /(?:Jan\.|Feb\.|Mar\.|Apr\.|May|June|July|Aug\.|Sept\.|Oct\.|Nov\.|Dec\.)\s+\d{1,2}(?:,\s*\d{4})?/.exec(text);
  if (!match) return null;
  const normalized = match[0]
    .replace(/Jan\./, "January")
    .replace(/Feb\./, "February")
    .replace(/Mar\./, "March")
    .replace(/Apr\./, "April")
    .replace(/Aug\./, "August")
    .replace(/Sept\./, "September")
    .replace(/Oct\./, "October")
    .replace(/Nov\./, "November")
    .replace(/Dec\./, "December");
  const withYear = /,\s*(\d{4})$/.test(normalized) ? normalized : `${normalized}, ${year}`;
  const date = new Date(withYear);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

async function loadReleaseSchedule(year) {
  const response = await fetch(`${BLS_SCHEDULE_BASE}/${year}/home.htm`, {
    headers: { "User-Agent": "MujiFx-Fundamental-Analyst/1.0 (BLS public-data ingestion)", Accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok) throw new Error(`BLS ${year} release schedule failed with HTTP ${response.status}.`);
  const html = await response.text();
  const schedule = new Map();
  const rowMatches = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];

  for (const rawRow of rowMatches) {
    const rowText = rawRow
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();

    const releaseMatch = /The Employment Situation,\s*([A-Za-z]+)\s+(\d{4})/i.exec(rowText);
    if (!releaseMatch) continue;

    const releasePeriod = parseObservationMonth(`${releaseMatch[1]} ${releaseMatch[2]}`);
    if (!releasePeriod) continue;

    const afterRelease = rowText.slice((releaseMatch.index ?? 0) + releaseMatch[0].length);
    const releaseDate = parseScheduleDate(afterRelease, year);
    if (releaseDate) schedule.set(releasePeriod, releaseDate);
  }

  // Some archived BLS pages use table markup that is not reliably matched.
  // Fallback accepts only a date immediately following the release title.
  if (!schedule.size) {
    const compact = html
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ");
    const fallbackPattern = /The Employment Situation,\s*([A-Za-z]+)\s+(\d{4})\s+((?:Jan\.|Feb\.|Mar\.|Apr\.|May|June|July|Aug\.|Sept\.|Oct\.|Nov\.|Dec\.)\s+\d{1,2}(?:,\s*\d{4})?)/gi;
    let match;
    while ((match = fallbackPattern.exec(compact)) !== null) {
      const releasePeriod = parseObservationMonth(`${match[1]} ${match[2]}`);
      const releaseDate = parseScheduleDate(match[3], year);
      if (releasePeriod && releaseDate) schedule.set(releasePeriod, releaseDate);
    }
  }

  if (!schedule.size) throw new Error(`BLS ${year} release schedule contained no Employment Situation dates.`);
  return schedule;
}

function parseWorkbook(bytes) {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true, raw: true });
  const sheet = workbook.Sheets.Data;
  if (!sheet) throw new Error("BLS vintage workbook is missing the Data sheet.");

  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  if (matrix.length < 4) throw new Error("BLS vintage Data sheet does not contain enough rows.");

  let headerRowIndex = -1;
  let observationColumns = [];

  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 10); rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const candidate = [];
    for (let index = 1; index < row.length; index += 1) {
      const observationDate = parseObservationMonth(row[index]);
      if (observationDate) candidate.push({ index, observationDate });
    }
    if (candidate.length > observationColumns.length) {
      observationColumns = candidate;
      headerRowIndex = rowIndex;
    }
  }

  if (headerRowIndex < 0 || !observationColumns.length) {
    throw new Error("No reference-month columns found in BLS vintage workbook.");
  }

  const releases = new Map();
  for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const releasePeriod = parseReleasePeriod(row[0]);
    if (!releasePeriod || releasePeriod < FIRST_RELEASE_PERIOD) continue;

    const rows = releases.get(releasePeriod) ?? [];
    for (const column of observationColumns) {
      const value = numeric(row[column.index]);
      if (value === null) continue;
      rows.push({ observationDate: column.observationDate, releaseDate: releasePeriod, value });
    }
    if (rows.length) releases.set(releasePeriod, rows);
  }

  return [...releases.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([releasePeriod, rows]) => ({ releasePeriod, rows }));
}

async function publish(rows, releasePeriod, publicationDate) {
  const response = await fetch(VERCEL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "NFP",
      snapshot: { snapshotUrl: BLS_URL, publicationDate, label: "BLS CES Total Nonfarm Vintage Data" },
      rows,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) throw new Error(`Release ${releasePeriod} failed: HTTP ${response.status}: ${responseText}`);
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

const years = [...new Set(releases.map(({ releasePeriod }) => Number(releasePeriod.slice(0, 4))))];
const schedules = new Map();
for (const year of years) {
  const schedule = await loadReleaseSchedule(year);
  for (const [period, date] of schedule) schedules.set(period, date);
}

let totalRows = 0;
let requests = 0;

for (const release of releases) {
  const releaseDate = schedules.get(release.releasePeriod);
  if (!releaseDate) throw new Error(`No official BLS Employment Situation release date found for ${release.releasePeriod}.`);

  const eligibleRows = release.rows
    .filter((row) => row.observationDate <= release.releasePeriod)
    .map((row) => ({ ...row, releaseDate }));

  if (!eligibleRows.length) continue;

  for (let start = 0; start < eligibleRows.length; start += MAX_ROWS_PER_REQUEST) {
    const chunk = eligibleRows.slice(start, start + MAX_ROWS_PER_REQUEST);
    await publish(chunk, release.releasePeriod, publicationDate);
    requests += 1;
    totalRows += chunk.length;
  }

  console.log(JSON.stringify({ releasePeriod: release.releasePeriod, releaseDate, rows: eligibleRows.length, requests, totalRows }));
}

console.log(JSON.stringify({ success: true, mode: "historical-backfill", publicationDate, eligibleReleases: releases.length, requests, totalRows }, null, 2));