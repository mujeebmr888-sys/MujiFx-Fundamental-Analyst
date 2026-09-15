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

  if (parsed.hostname !== "www.bls.gov") {
    throw new Error("NFP snapshots must come from the official www.bls.gov host.");
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
