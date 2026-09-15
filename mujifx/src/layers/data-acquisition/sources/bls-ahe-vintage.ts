/**
 * BLS CES AVERAGE HOURLY EARNINGS PUBLISHED-SNAPSHOT ADAPTER
 *
 * Accepts rows parsed from an exact official BLS published snapshot and never
 * treats a live API retrieval as vintage evidence.
 */

import type { IndicatorId } from "@/types/economic-data";
import {
  blsPublishedSnapshotProvenance,
  type BlsPublishedSnapshotDescriptor,
} from "@/layers/data-acquisition/sources/bls-snapshot-provenance";
import { assertFiniteSnapshotRows } from "@/layers/data-acquisition/sources/published-snapshot-validation";
import { writeAuthoritativeVintage } from "@/layers/historical-database/authoritative-vintage-writer";

export interface BlsAheSnapshotRow {
  observationDate: string;
  value: number;
  isMissing?: boolean;
}

export interface WriteBlsAheSnapshotInput {
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

export async function writeBlsAheSnapshot(
  input: WriteBlsAheSnapshotInput
): Promise<unknown[]> {
  assertFiniteSnapshotRows(input.rows, "BLS AHE");

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

    results.push(
      await writeAuthoritativeVintage(
        {
          indicator: input.indicator,
          observationDate: row.observationDate.trim(),
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
