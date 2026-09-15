/**
 * BLS CES TOTAL NONFARM PAYROLL PUBLISHED-VINTAGE ADAPTER
 *
 * BLS publishes official CES vintage tables containing the employment value
 * for a reference month as it was published at each Employment Situation
 * release. This adapter accepts rows parsed from that official snapshot and
 * never treats the live BLS API as vintage evidence.
 */

import type { IndicatorId } from "@/types/economic-data";
import {
  blsPublishedSnapshotProvenance,
  type BlsPublishedSnapshotDescriptor,
} from "@/layers/data-acquisition/sources/bls-snapshot-provenance";
import { writeAuthoritativeVintage } from "@/layers/historical-database/authoritative-vintage-writer";

export interface BlsNfpSnapshotRow {
  observationDate: string;
  value: number;
  isMissing?: boolean;
}

export interface WriteBlsNfpSnapshotInput {
  /** BLS CES seasonally adjusted total nonfarm series. */
  seriesId: "CES0000000001";
  indicator: Extract<IndicatorId, "NFP">;
  sourceName: string;
  sourceUrl: string;
  sourceTier: "TIER_1_OFFICIAL";
  retrievedAt: string;
  snapshot: BlsPublishedSnapshotDescriptor;
  rows: BlsNfpSnapshotRow[];
}

function assertMonth(value: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error(`BLS NFP observationDate must be YYYY-MM: ${value}`);
  }
}

/**
 * Persist rows from one exact BLS CES published vintage snapshot.
 *
 * The snapshot publication date is the point-in-time availability marker.
 * A live BLS API retrieval cannot be passed through this adapter as vintage
 * evidence because the API exposes current observations rather than an
 * immutable historical release version.
 */
export async function writeBlsNfpSnapshot(
  input: WriteBlsNfpSnapshotInput
): Promise<unknown[]> {
  if (!input.rows.length) {
    throw new Error("BLS NFP snapshot contains no observations.");
  }

  if (input.indicator !== "NFP" || input.seriesId !== "CES0000000001") {
    throw new Error(
      `BLS NFP series ${input.seriesId} does not match indicator ${input.indicator}.`
    );
  }

  const provenance = blsPublishedSnapshotProvenance(input.snapshot);
  const results: unknown[] = [];

  for (const row of input.rows) {
    assertMonth(row.observationDate);
    if (!Number.isFinite(row.value)) {
      throw new Error(
        `BLS NFP snapshot contains a non-finite value for ${row.observationDate}.`
      );
    }

    results.push(
      await writeAuthoritativeVintage(
        {
          indicator: input.indicator,
          observationDate: row.observationDate,
          value: row.value,
          isMissing: row.isMissing ?? false,
          retrievedAt: input.retrievedAt,
          sourceName: input.sourceName,
          sourceUrl: input.sourceUrl,
          sourceTier: input.sourceTier,
          provenance,
        },
        `BLS CES total nonfarm published snapshot ${input.snapshot.label}`
      )
    );
  }

  return results;
}
