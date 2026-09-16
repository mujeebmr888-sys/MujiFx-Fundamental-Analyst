import XLSX from "xlsx";

const BLS_URL = "https://www.bls.gov/web/empsit/cesvin00.xlsx";
const BLS_SCHEDULE_URL = "https://www.bls.gov/schedule/news_release/empsit.htm";
const VERCEL_URL = process.env.VERCEL_VINTAGE_URL;
const SECRET = process.env.VERCEL_CRON_SECRET;
const MAX_ROWS = 5000;

if (!VERCEL_URL || !SECRET) throw new Error("VERCEL_VINTAGE_URL and CRON_SECRET GitHub secret are required.");

const pad = (v) => String(v).padStart(2, "0");
const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];

function monthNameToNumber(value) {
  const text = String(value).trim().toLowerCase();
  const full = months.indexOf(text);
  if (full >= 0) return full + 1;
  const short = months.findIndex((m) => m.slice(0, 3) === text.slice(0, 3));
  return short >= 0 ? short + 1 : null;
}

function excelSerialToDate(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 100000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
}

function clean(value) {
  return String(value).trim().replace(/\s*\([^)]*\)\s*$/g, "").replace(/\s*\[[^\]]*\]\s*$/g, "").replace(/\*/g, "").trim();
}

function parseObservationMonth(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}`;
  if (typeof value === "number") {
    const date = excelSerialToDate(value);
    if (date) return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
  }
  if (typeof value !== "string") return null;
  const text = clean(value).replace(/_/g, "-");
  let m = /^(\d{4})[-\/]([0-1]\d)$/.exec(text);
  if (m && Number(m[2]) <= 12) return `${m[1]}-${m[2]}`;
  m = /^([A-Za-z]+)[\s\/-]+(\d{4})$/.exec(text);
  if (m) { const month = monthNameToNumber(m[1]); if (month) return `${m[2]}-${pad(month)}`; }
  m = /^(\d{4})[\s\/-]+([A-Za-z]+)$/.exec(text);
  if (m) { const month = monthNameToNumber(m[2]); if (month) return `${m[1]}-${pad(month)}`; }
  m = /^([A-Za-z]{3,9})[-\/](\d{2})$/.exec(text);
  if (m) { const month = monthNameToNumber(m[1]); if (month) { const y = Number(m[2]); return `${y >= 30 ? 1900 + y : 2000 + y}-${pad(month)}`; } }
  return null;
}

function parseReleaseMonth(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}`;
  if (typeof value === "number") {
    const date = excelSerialToDate(value);
    if (date) return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
  }
  if (typeof value !== "string") return null;
  const text = clean(value);
  const m = /^([A-Za-z]{3,9})\s+(\d{2}|\d{4})(?:\s+first preliminary release|\s+third preliminary release|\s+final release)?$/i.exec(text);
  if (!m) return null;
  const month = monthNameToNumber(m[1]);
  if (!month) return null;
  const rawYear = Number(m[2]);
  const year = m[2].length === 2 ? (rawYear >= 30 ? 1900 + rawYear : 2000 + rawYear) : rawYear;
  return `${year}-${pad(month)}`;
}

function parseValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const n = Number(value.trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseWorkbook(bytes) {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true, raw: false });
  const sheet = workbook.Sheets.Data;
  if (!sheet) throw new Error("BLS CES vintage workbook is missing the Data sheet.");
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null });
  let headerRowIndex = -1;
  let columns = [];
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 30); rowIndex++) {
    const row = matrix[rowIndex] ?? [];
    const candidate = [];
    for (let i = 1; i < row.length; i++) {
      const observationDate = parseObservationMonth(row[i]);
      if (observationDate) candidate.push({ index: i, observationDate });
    }
    if (candidate.length > columns.length) { columns = candidate; headerRowIndex = rowIndex; }
  }
  if (headerRowIndex < 0 || !columns.length) throw new Error("No observation-month columns found in BLS vintage workbook.");

  const releases = new Map();
  for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex++) {
    const row = matrix[rowIndex] ?? [];
    const releaseMonth = parseReleaseMonth(row[0]);
    if (!releaseMonth) continue;
    const rows = [];
    for (const column of columns) {
      const value = parseValue(row[column.index]);
      if (value !== null) rows.push({ observationDate: column.observationDate, releaseMonth, value });
    }
    if (rows.length) releases.set(releaseMonth, rows);
  }
  return [...releases.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([releaseMonth, rows]) => ({ releaseMonth, rows }));
}

async function fetchEmploymentSituationSchedule() {
  const response = await fetch(BLS_SCHEDULE_URL, { headers: { "User-Agent": "MujiFx-Fundamental-Analyst/1.0 (BLS public-data ingestion)" } });
  if (!response.ok) throw new Error(`BLS Employment Situation schedule failed with HTTP ${response.status}.`);
  const html = await response.text();
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ");
  const map = new Map();
  const monthNames = "January|February|March|April|May|June|July|August|September|October|November|December";
  const dateRe = new RegExp(`(${monthNames})\\s+(\\d{4})\\s+([A-Za-z]{3,9}\\.?\\s+\\d{1,2},\\s+\\d{4})`, "g");
  for (const match of text.matchAll(dateRe)) {
    const refMonth = `${match[2]}-${pad(monthNameToNumber(match[1]))}`;
    const parsed = new Date(match[3].replace(/\./g, ""));
    if (!Number.isNaN(parsed.getTime())) map.set(refMonth, parsed.toISOString().slice(0, 10));
  }
  return map;
}

const response = await fetch(BLS_URL, { headers: {
  Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream;q=0.9, */*;q=0.1",
  "User-Agent": "MujiFx-Fundamental-Analyst/1.0 (BLS public-data ingestion)",
  Referer: "https://www.bls.gov/",
  "Accept-Encoding": "identity",
} });
if (!response.ok) throw new Error(`BLS vintage download failed with HTTP ${response.status}.`);
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

const schedule = await fetchEmploymentSituationSchedule();
const exactReleaseDate = schedule.get(latest.releaseMonth);
if (!exactReleaseDate) throw new Error(`No official BLS Employment Situation release date found for reference month ${latest.releaseMonth}.`);

const rows = latest.rows.map(({ observationDate, value }) => ({ observationDate, releaseDate: exactReleaseDate, value }));
const body = { kind: "NFP", snapshot: { snapshotUrl: BLS_URL, publicationDate, label: "BLS CES Total Nonfarm Vintage Data" }, rows };

const publish = await fetch(VERCEL_URL, { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const text = await publish.text();
if (!publish.ok) throw new Error(`Vercel vintage publish failed with HTTP ${publish.status}: ${text}`);
console.log(JSON.stringify({ success: true, releaseMonth: latest.releaseMonth, releaseDate: exactReleaseDate, publicationDate, rows: rows.length, releasesAvailable: releases.length, publishResponse: text }, null, 2));
