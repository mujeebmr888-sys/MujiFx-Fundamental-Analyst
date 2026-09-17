import XLSX from "xlsx";

const BLS_URL = "https://www.bls.gov/web/empsit/cesvin00.xlsx";
const VERCEL_URL = process.env.VERCEL_VINTAGE_URL;
const SECRET = process.env.VERCEL_CRON_SECRET;
const MAX_ROWS_PER_REQUEST = 5000;

if (!VERCEL_URL || !SECRET) throw new Error("VERCEL_VINTAGE_URL and CRON_SECRET are required.");

const pad = (v) => String(v).padStart(2, "0");
const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];

function monthNumber(value) {
  const text = String(value).trim().toLowerCase();
  const full = months.indexOf(text);
  if (full >= 0) return full + 1;
  const short = months.findIndex((m) => m.slice(0, 3) === text.slice(0, 3));
  return short >= 0 ? short + 1 : null;
}

function excelDate(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
}

function observationMonth(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}`;
  if (typeof value === "number") {
    const d = excelDate(value);
    if (d) return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  }
  const text = String(value ?? "").trim().replace(/_/g, "-");
  let m = /^(\d{4})[-\/]([01]\d)$/.exec(text);
  if (m && Number(m[2]) <= 12) return `${m[1]}-${m[2]}`;
  m = /^([A-Za-z]+)[\s\/-]+(\d{4})$/.exec(text);
  if (m) { const n = monthNumber(m[1]); if (n) return `${m[2]}-${pad(n)}`; }
  m = /^(\d{4})[\s\/-]+([A-Za-z]+)$/.exec(text);
  if (m) { const n = monthNumber(m[2]); if (n) return `${m[1]}-${pad(n)}`; }
  return null;
}

function releaseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const parsed = new Date(String(value ?? "").trim());
  if (Number.isNaN(parsed.getTime())) return null;
  const iso = parsed.toISOString().slice(0, 10);
  return /^20\d{2}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function numeric(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(String(value ?? "").trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseWorkbook(bytes) {
  const wb = XLSX.read(bytes, { type: "buffer", cellDates: true, raw: true });
  const sheet = wb.Sheets.Data;
  if (!sheet) throw new Error("BLS workbook is missing Data sheet.");
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  if (matrix.length < 4) throw new Error("BLS Data sheet is too short.");

  const header = matrix[2] ?? [];
  const columns = [];
  for (let i = 1; i < header.length; i++) {
    const observationDate = observationMonth(header[i]);
    if (observationDate) columns.push({ index: i, observationDate });
  }
  if (!columns.length) throw new Error("No observation-month columns found.");

  const releases = new Map();
  for (let r = 3; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const rel = releaseDate(row[0]);
    if (!rel) continue;
    const rows = [];
    for (const col of columns) {
      const value = numeric(row[col.index]);
      if (value !== null) rows.push({ observationDate: col.observationDate, releaseDate: rel, value });
    }
    if (rows.length) releases.set(rel, rows);
  }
  return [...releases.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([releaseDate, rows]) => ({ releaseDate, rows }));
}

async function publish(rows, publicationDate, releaseDate) {
  const snapshot = {
    snapshotUrl: BLS_URL,
    publicationDate,
    label: "BLS CES Total Nonfarm Vintage Data",
  };
  const response = await fetch(VERCEL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "NFP", snapshot, rows }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Release ${releaseDate} failed: HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
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
const releases = parseWorkbook(Buffer.from(await response.arrayBuffer()));

let totalRows = 0;
let requests = 0;
for (const release of releases) {
  for (let start = 0; start < release.rows.length; start += MAX_ROWS_PER_REQUEST) {
    const chunk = release.rows.slice(start, start + MAX_ROWS_PER_REQUEST);
    await publish(chunk, publicationDate, release.releaseDate);
    requests += 1;
    totalRows += chunk.length;
  }
  console.log(JSON.stringify({ releaseDate: release.releaseDate, rows: release.rows.length, requests, totalRows }));
}

console.log(JSON.stringify({ success: true, publicationDate, releases: releases.length, requests, totalRows }, null, 2));
