/**
 * AUTHORITATIVE VERSIONED VINTAGE INGESTION
 *
 * Protected bridge for exact published snapshots from approved official
 * sources. This endpoint never fetches a live API and never turns retrieval
 * time or a release-calendar date into a vintage by itself.
 *
 * The caller must provide rows already parsed from an exact official
 * published snapshot. Source identity and allowed host are enforced here.
 */
import { NextResponse } from "next/server";
import { writeBlsCpiSnapshot } from "@/layers/data-acquisition/sources/bls-cpi-vintage";
import { writeBlsNfpSnapshot } from "@/layers/data-acquisition/sources/bls-nfp-vintage";
import { writeBlsAheSnapshot } from "@/layers/data-acquisition/sources/bls-ahe-vintage";
import { writeBeaPceSnapshot } from "@/layers/data-acquisition/sources/bea-pce-vintage";
import { writeBeaGdpSnapshot } from "@/layers/data-acquisition/sources/bea-gdp-vintage";
import { writeFedFundsSnapshot } from "@/layers/data-acquisition/sources/fed-funds-vintage";

export const dynamic = "force-dynamic";

const MAX_ROWS = 5000;

type SnapshotKind =
  | "CPI"
  | "CORE_CPI"
  | "NFP"
  | "AVG_HOURLY_EARNINGS"
  | "PCE"
  | "CORE_PCE"
  | "GDP_GROWTH_RATE"
  | "FED_FUNDS_RATE";

interface SnapshotBody {
  kind: SnapshotKind;
  snapshot: {
    snapshotUrl: string;
    publicationDate: string;
    label: string;
  };
  rows: Array<{
    observationDate: string;
    value: number;
    isMissing?: boolean;
  }>;
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const headerSecret = request.headers.get("x-cron-secret");
  const authorization = request.headers.get("authorization");
  return (
    headerSecret === secret ||
    authorization === `Bearer ${secret}`
  );
}

function officialHostFor(kind: SnapshotKind): string {
  return kind === "CPI" || kind === "CORE_CPI" || kind === "NFP" || kind === "AVG_HOURLY_EARNINGS"
    ? "www.bls.gov"
    : kind === "PCE" || kind === "CORE_PCE" || kind === "GDP_GROWTH_RATE"
      ? "www.bea.gov"
      : "www.federalreserve.gov";
}

function assertOfficialSnapshotUrl(kind: SnapshotKind, snapshotUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(snapshotUrl);
  } catch {
    throw new Error("snapshotUrl must be a valid HTTPS URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("snapshotUrl must use HTTPS.");
  }

  const expectedHost = officialHostFor(kind);
  if (parsed.hostname !== expectedHost) {
    throw new Error(
      `${kind} snapshots must come from the official ${expectedHost} host.`
    );
  }
}

function validateBody(body: unknown): SnapshotBody {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object.");
  }

  const input = body as Partial<SnapshotBody>;
  const allowedKinds: SnapshotKind[] = [
    "CPI",
    "CORE_CPI",
    "NFP",
    "AVG_HOURLY_EARNINGS",
    "PCE",
    "CORE_PCE",
    "GDP_GROWTH_RATE",
    "FED_FUNDS_RATE",
  ];

  if (!input.kind || !allowedKinds.includes(input.kind)) {
    throw new Error("Unsupported authoritative snapshot kind.");
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

  assertOfficialSnapshotUrl(input.kind, snapshot.snapshotUrl);

  for (const row of input.rows) {
    if (
      !row ||
      typeof row.observationDate !== "string" ||
      typeof row.value !== "number" ||
      !Number.isFinite(row.value)
    ) {
      throw new Error("Every row needs observationDate and a finite numeric value.");
    }
  }

  return {
    kind: input.kind,
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
    const sourceTier = "TIER_1_OFFICIAL" as const;

    let written: unknown[];

    switch (body.kind) {
      case "CPI":
      case "CORE_CPI":
        written = await writeBlsCpiSnapshot({
          seriesId: body.kind === "CPI" ? "CUSR0000SA0" : "CUSR0000SA0L1E",
          indicator: body.kind,
          sourceName: "U.S. Bureau of Labor Statistics (BLS)",
          sourceUrl: snapshot.snapshotUrl,
          sourceTier,
          retrievedAt,
          snapshot,
          rows: body.rows,
        });
        break;
      case "NFP":
        written = await writeBlsNfpSnapshot({
          seriesId: "CES0000000001",
          indicator: "NFP",
          sourceName: "U.S. Bureau of Labor Statistics (BLS)",
          sourceUrl: snapshot.snapshotUrl,
          sourceTier,
          retrievedAt,
          snapshot,
          rows: body.rows,
        });
        break;
      case "AVG_HOURLY_EARNINGS":
        written = await writeBlsAheSnapshot({
          seriesId: "CES0500000003",
          indicator: "AVG_HOURLY_EARNINGS",
          sourceName: "U.S. Bureau of Labor Statistics (BLS)",
          sourceUrl: snapshot.snapshotUrl,
          sourceTier,
          retrievedAt,
          snapshot,
          rows: body.rows,
        });
        break;
      case "PCE":
      case "CORE_PCE":
        written = await writeBeaPceSnapshot({
          seriesCode: body.kind === "PCE" ? "DPCERG" : "DPCCRG",
          indicator: body.kind,
          sourceName: "U.S. Bureau of Economic Analysis (BEA)",
          sourceUrl: snapshot.snapshotUrl,
          sourceTier,
          retrievedAt,
          snapshot,
          rows: body.rows,
        });
        break;
      case "GDP_GROWTH_RATE":
        written = await writeBeaGdpSnapshot({
          tableId: "T10101",
          lineCode: "1",
          indicator: "GDP_GROWTH_RATE",
          sourceName: "U.S. Bureau of Economic Analysis (BEA)",
          sourceUrl: snapshot.snapshotUrl,
          sourceTier,
          retrievedAt,
          snapshot,
          rows: body.rows,
        });
        break;
      case "FED_FUNDS_RATE":
        written = await writeFedFundsSnapshot({
          seriesId: "RIFSPFF_N.M",
          indicator: "FED_FUNDS_RATE",
          sourceName: "Federal Reserve Board (H.15)",
          sourceUrl: snapshot.snapshotUrl,
          sourceTier,
          retrievedAt,
          snapshot,
          rows: body.rows,
        });
        break;
    }

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
