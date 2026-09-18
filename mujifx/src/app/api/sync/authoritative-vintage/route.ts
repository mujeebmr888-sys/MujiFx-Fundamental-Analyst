import { NextResponse } from "next/server";
import { writeBlsNfpSnapshot } from "@/layers/data-acquisition/sources/bls-nfp-vintage";
import {
  BLS_NFP_VINTAGE_URL,
  parseBlsNfpVintageWorkbook,
} from "@/layers/data-acquisition/sources/bls-nfp-vintage-parser";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ROWS = 5000;
const BLS_NFP_VINTAGE_PATH = "/web/empsit/cesvin00.xlsx";
type SnapshotKind = "NFP";

interface SnapshotBody {
  kind: SnapshotKind;
  snapshot: {
    snapshotUrl: string;
    publicationDate: string;
    label: string;
  };
  rows: Array<{
    observationDate: string;
    releaseDate: string;
    value: number;
    isMissing?: boolean;
  }>;
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const headerSecret = request.headers.get("x-cron-secret");
  const authorization = request.headers.get("authorization");
  return headerSecret === secret || authorization === `Bearer ${secret}`;
}

function parseIsoDate(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must be YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} is invalid: ${value}`);
  }
  return parsed;
}

async function resolveOfficialNfpReleaseDate(releasePeriod: string): Promise<string> {
  const year = releasePeriod.slice(0, 4);
  const response = await fetch("https://www.bls.gov/schedule/" + year + "/home.htm", {
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "MujiFx-Fundamental-Analyst/1.0 (BLS public-data ingestion)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("BLS " + year + " release schedule failed with HTTP " + response.status + ".");
  const html = await response.text();
  const text = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ");
  const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const month = monthNames[Number(releasePeriod.slice(5, 7)) - 1];
  const pattern = new RegExp("The Employment Situation,\\s*" + month + "\\s+" + year + "\\s+([A-Za-z]+\\.?\\s+\\d{1,2}(?:,\\s*\\d{4})?)", "i");
  const match = pattern.exec(text);
  if (!match) throw new Error("No official BLS Employment Situation release date found for " + releasePeriod + ".");
  const normalized = match[1].replace(/Jan\./i,"January").replace(/Feb\./i,"February").replace(/Mar\./i,"March").replace(/Apr\./i,"April").replace(/Aug\./i,"August").replace(/Sept\./i,"September").replace(/Oct\./i,"October").replace(/Nov\./i,"November").replace(/Dec\./i,"December");
  const date = new Date(/,\s*\d{4}$/.test(normalized) ? normalized : normalized + ", " + year);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid official BLS release date for " + releasePeriod + ": " + match[1]);
  return date.toISOString().slice(0, 10);
}
function assertOfficialSnapshotUrl(snapshotUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(snapshotUrl);
  } catch {
    throw new Error("snapshotUrl must be a valid HTTPS URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("snapshotUrl must use HTTPS.");
  }

  if (parsed.hostname !== "www.bls.gov" || parsed.pathname !== BLS_NFP_VINTAGE_PATH) {
    throw new Error(
      `NFP snapshots must use the official BLS total-nonfarm vintage file: ${BLS_NFP_VINTAGE_PATH}.`
    );
  }
}

function assertNfpVintageDateSemantics(
  observationDate: string,
  releaseDate: string,
  publicationDate: string
): void {
  const observationMatch = /^(\d{4})-(\d{2})$/.exec(observationDate);
  if (!observationMatch) {
    throw new Error(`BLS NFP observationDate must be YYYY-MM: ${observationDate}`);
  }

  const month = Number(observationMatch[2]);
  if (month < 1 || month > 12) {
    throw new Error(`BLS NFP observationDate has an invalid month: ${observationDate}`);
  }

  const release = parseIsoDate(releaseDate, "releaseDate");
  const publication = parseIsoDate(publicationDate, "snapshot publicationDate");
  const observationEnd = new Date(Date.UTC(Number(observationMatch[1]), month, 0));

  if (release <= observationEnd) {
    throw new Error(
      `NFP releaseDate ${releaseDate} must be after observation month ${observationDate}.`
    );
  }

  if (release > publication) {
    throw new Error(
      `NFP releaseDate ${releaseDate} cannot be after snapshot publicationDate ${publicationDate}.`
    );
  }
}

function validateBody(body: unknown): SnapshotBody {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object.");
  }

  const input = body as Partial<SnapshotBody>;
  if (input.kind !== "NFP") {
    throw new Error(
      "Unsupported authoritative vintage kind. Only NFP has a verified source-specific vintage artifact."
    );
  }

  if (!input.snapshot || typeof input.snapshot !== "object") {
    throw new Error("snapshot is required.");
  }

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new Error("rows must contain at least one parsed observation.");
  }
  if (input.rows.length > MAX_ROWS) {
    throw new Error(`rows cannot exceed ${MAX_ROWS} observations.`);
  }

  const snapshot = input.snapshot;
  if (
    typeof snapshot.snapshotUrl !== "string" ||
    typeof snapshot.publicationDate !== "string" ||
    typeof snapshot.label !== "string"
  ) {
    throw new Error("snapshotUrl, publicationDate and label are required.");
  }

  assertOfficialSnapshotUrl(snapshot.snapshotUrl);
  parseIsoDate(snapshot.publicationDate, "snapshot publicationDate");

  const seen = new Set<string>();
  for (const row of input.rows) {
    if (
      !row ||
      typeof row.observationDate !== "string" ||
      typeof row.releaseDate !== "string" ||
      typeof row.value !== "number" ||
      !Number.isFinite(row.value)
    ) {
      throw new Error(
        "Every NFP vintage row needs observationDate, releaseDate and a finite numeric value."
      );
    }

    const observationDate = row.observationDate.trim();
    const releaseDate = row.releaseDate.trim();
    const key = `${observationDate}|${releaseDate}`;
    if (seen.has(key)) throw new Error(`Duplicate NFP vintage row: ${key}`);
    seen.add(key);

    assertNfpVintageDateSemantics(observationDate, releaseDate, snapshot.publicationDate.trim());
  }

  return { kind: "NFP", snapshot, rows: input.rows };
}

async function fetchBlsSnapshot() {
  const response = await fetch(BLS_NFP_VINTAGE_URL, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream;q=0.9, */*;q=0.1",
      "User-Agent": "MujiFx-Fundamental-Analyst/1.0 (BLS public-data ingestion)",
      Referer: "https://www.bls.gov/",
      "Accept-Encoding": "identity",
    },
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    throw new Error(`BLS vintage download failed with HTTP ${response.status}.`);
  }

  const lastModified = response.headers.get("last-modified");
  if (!lastModified) {
    throw new Error("BLS vintage download did not provide Last-Modified provenance.");
  }

  const publication = new Date(lastModified);
  if (Number.isNaN(publication.getTime())) {
    throw new Error(`BLS Last-Modified header is invalid: ${lastModified}`);
  }

  const publicationDate = publication.toISOString().slice(0, 10);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength) throw new Error("BLS vintage download was empty.");

  return { bytes, publicationDate };
}

async function ingestLatestBlsNfpVintage() {
  const { bytes, publicationDate } = await fetchBlsSnapshot();
  const releases = parseBlsNfpVintageWorkbook(bytes);
  const latest = releases[releases.length - 1];
  if (!latest) throw new Error("BLS vintage workbook contains no release rows.");

  const rows = latest.rows;
  if (rows.length > MAX_ROWS) {
    throw new Error(`Latest BLS NFP release contains ${rows.length} rows; limit is ${MAX_ROWS}.`);
  }

  const releaseDate = await resolveOfficialNfpReleaseDate(latest.releasePeriod);
  const normalizedRows = rows.map((row) => ({ ...row, releaseDate }));

  const snapshot = {
    snapshotUrl: BLS_NFP_VINTAGE_URL,
    publicationDate,
    label: "BLS CES Total Nonfarm Vintage Data",
  };

  validateBody({ kind: "NFP", snapshot, rows: normalizedRows });

  const written = await writeBlsNfpSnapshot({
    seriesId: "CES0000000001",
    indicator: "NFP",
    sourceName: "U.S. Bureau of Labor Statistics (BLS)",
    sourceUrl: BLS_NFP_VINTAGE_URL,
    sourceTier: "TIER_1_OFFICIAL",
    retrievedAt: new Date().toISOString(),
    snapshot,
    rows: normalizedRows,
  });

  return {
    kind: "NFP" as const,
    releaseDate,
    snapshot,
    releasesAvailable: releases.length,
    rowsReceived: rows.length,
    rowsWritten: written.length,
  };
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, reason: "CRON_SECRET is not configured." },
      { status: 503 }
    );
  }

  if (!authorized(request)) {
    return NextResponse.json({ success: false, reason: "Unauthorized." }, { status: 401 });
  }

  try {
    return NextResponse.json({ success: true, ...(await ingestLatestBlsNfpVintage()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Automatic BLS NFP vintage ingestion failed:", message);
    return NextResponse.json(
      { success: false, stage: "automatic-authoritative-vintage-ingestion", reason: message },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, reason: "CRON_SECRET is not configured." },
      { status: 503 }
    );
  }

  if (!authorized(request)) {
    return NextResponse.json({ success: false, reason: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = validateBody(await request.json());
    const snapshot = body.snapshot;
    const written = await writeBlsNfpSnapshot({
      seriesId: "CES0000000001",
      indicator: "NFP",
      sourceName: "U.S. Bureau of Labor Statistics (BLS)",
      sourceUrl: snapshot.snapshotUrl,
      sourceTier: "TIER_1_OFFICIAL",
      retrievedAt: new Date().toISOString(),
      snapshot,
      rows: body.rows,
    });

    return NextResponse.json({
      success: true,
      kind: body.kind,
      snapshot,
      rowsReceived: body.rows.length,
      rowsWritten: written.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Authoritative vintage ingestion failed:", message);
    return NextResponse.json(
      { success: false, stage: "authoritative-vintage-ingestion", reason: message },
      { status: 400 }
    );
  }
}
