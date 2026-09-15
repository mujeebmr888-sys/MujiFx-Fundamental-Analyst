/**
 * BLS CES AVERAGE HOURLY EARNINGS PUBLISHED-SNAPSHOT ADAPTER
 *
 * BLS publishes official CES employment, hours, and earnings data and
 * maintains archived published values. This adapter accepts rows parsed from
 * an exact official BLS published snapshot and never treats a live API
 * retrieval as vintage evidence.
 */

import type { IndicatorId } from "@/types/economic-data";
import {
  blsPublishedSnapshotProvenance,
  type BlsPublishedSnapshotDescriptor,
} from "@/layers/data-acquisition/sources/bls-snapshot-provenance";
import { writeAuthoritativeVintage } from "@/layers/historical-database/authoritative-vintage-writer";

export interface BlsAheSnapshotRow {
  observationDate: string;
  value: number;
  isMissing?: boolean;
}

export interface WriteBlsAheSnapshotInput {
  /** BLS CES seasonally adjusted all-employees average hourly earnings series. */
  seriesId: "CES0500000003";
  indicator: Extract<IndicatorId, "AVG_HOURLY_EARNINGS">;
  sourceName: string;
  sourceUrl: string;
  sourceTier: "TIER_1_OFFICIAL";
  retrievedAt: string;
  snapshot: BlsPublishedSnapshotDescriptor;
  rows: BlsAheSnapshotRow[];
}

function assertMonth(value: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error(`BLS AHE observationDate must be YYYY-MM: ${value}`);
  }
}

/**
 * Persist rows from one exact BLS published AHE snapshot as point-in-time
 * observations. The snapshot publication date is the availability marker.
 */
export async function writeBlsAheSnapshot(
  input: WriteBlsAheSnapshotInput
): Promise<unknown[]> {
  if (!input.rows.length) {
    throw new Error("BLS AHE snapshot contains no observations.");
  }

  if (
    input.indicator !== "AVG_HOURLY_EARNINGS" ||
    input.seriesId !== "CES0500000003"
  ) {
    throw new Error(
      `BLS AHE series ${input.seriesId} does not match indicator ${input.indicator}.`
    );
  }

  const provenance = blsPublishedSnapshotProvenance(input.snapshot);
  const results: unknown[] = [];

  for (const row of input.rows) {
    assertMonth(row.observationDate);
    if (!Number.isFinite(row.value)) {
      throw new Error(
        `BLS AHE snapshot contains a non-finite value for ${row.observationDate}.`
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
        `BLS CES average hourly earnings published snapshot ${input.snapshot.label}`
      )
    );
  }

  return results;
}
