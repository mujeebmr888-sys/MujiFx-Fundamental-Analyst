/**
 * AUTHORITATIVE VERSIONED VINTAGE INGESTION
 *
 * Protected bridge for exact published snapshots from approved official
 * sources. This endpoint never fetches a live API and never turns retrieval
 * time or a release-calendar date into a vintage by itself.
 *
 * IMPORTANT: only sources with explicit vintage-eligible provenance may use
 * this endpoint. At present that is the BLS CES NFP vintage table. Other
 * published snapshots remain available through their source adapters for
 * future work, but are intentionally not exposed as vintage ingestion paths
 * until their source-specific version semantics are proven.
 */
import { NextResponse } from "next/server";
import { writeBlsNfpSnapshot } from "@/layers/data-acquisition/sources/bls-nfp-vintage";

export const dynamic = "force-dynamic";

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

  const release = parseIsoDate(releaseDate, "releaseDate");
  const publication = parseIsoDate(publicationDate, "snapshot publicationDate");
  const observationEnd = new Date(
    Date.UTC(Number(observationMatch[1]), Number(observationMatch[2]), 0)
  );

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

    assertNfpVintageDateSemantics(
      row.observationDate.trim(),
      row.releaseDate.trim(),
      snapshot.publicationDate.trim()
    );
  }

  return {
    kind: "NFP",
    snapshot,
    rows: input.rows,
  };
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, reason: "CRON_SECRET is not configured." },
      { status: 503 }
    );
  }

  if (!authorized(request)) {
    return NextResponse.json(
      { success: false, reason: "Unauthorized." },
      { status: 401 }
    );
  }

  try {
    const body = validateBody(await request.json());
    const retrievedAt = new Date().toISOString();
    const snapshot = body.snapshot;

    const written = await writeBlsNfpSnapshot({
      seriesId: "CES0000000001",
      indicator: "NFP",
      sourceName: "U.S. Bureau of Labor Statistics (BLS)",
      sourceUrl: snapshot.snapshotUrl,
      sourceTier: "TIER_1_OFFICIAL",
      retrievedAt,
      snapshot,
      rows: body.rows,
    });

    return NextResponse.json({
      success: true,
      kind: body.kind,
      snapshot: {
        label: snapshot.label,
        publicationDate: snapshot.publicationDate,
        sourceUrl: snapshot.snapshotUrl,
      },
      rowsReceived: body.rows.length,
      rowsWritten: written.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Authoritative vintage ingestion failed:", message);
    return NextResponse.json(
      {
        success: false,
        stage: "authoritative-vintage-ingestion",
        reason: message,
      },
      { status: 400 }
    );
  }
}
