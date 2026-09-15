/**
 * BLS CPI PUBLISHED-SNAPSHOT VINTAGE ADAPTER
 *
 * This adapter is deliberately separate from the live BLS API adapter.
 * Callers must supply rows parsed from an official BLS published snapshot
 * (for example, an archived CPI supplemental workbook) together with the
 * snapshot descriptor. Live API rows are not accepted as vintage evidence.
 */

import type { IndicatorId } from "@/types/economic-data";
import {
  blsPublishedSnapshotProvenance,
  type BlsPublishedSnapshotDescriptor,
} from "@/layers/data-acquisition/sources/bls-snapshot-provenance";
import { writeAuthoritativeVintage } from "@/layers/historical-database/authoritative-vintage-writer";

export interface BlsCpiSnapshotRow {
  observationDate: string;
  value: number;
  isMissing?: boolean;
}

export interface WriteBlsCpiSnapshotInput {
  seriesId: "CUSR0000SA0" | "CUSR0000SA0L1E";
  indicator: Extract<IndicatorId, "CPI" | "CORE_CPI">;
  sourceName: string;
  sourceUrl: string;
  sourceTier: "TIER_1_OFFICIAL";
  retrievedAt: string;
  snapshot: BlsPublishedSnapshotDescriptor;
  rows: BlsCpiSnapshotRow[];
}

function assertMonth(value: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error(`BLS CPI observationDate must be YYYY-MM: ${value}`);
  }
}

/**
 * Persist rows from one exact BLS published snapshot as point-in-time
 * observations. The snapshot publication date becomes realtime_start.
 */
export async function writeBlsCpiSnapshot(
  input: WriteBlsCpiSnapshotInput
): Promise<unknown[]> {
  if (!input.rows.length) {
    throw new Error("BLS CPI snapshot contains no observations.");
  }

  const expectedSeriesId =
    input.indicator === "CPI" ? "CUSR0000SA0" : "CUSR0000SA0L1E";
  if (input.seriesId !== expectedSeriesId) {
    throw new Error(
      `BLS CPI series ${input.seriesId} does not match indicator ${input.indicator}.`
    );
  }

  const provenance = blsPublishedSnapshotProvenance(input.snapshot);
  const results: unknown[] = [];

  for (const row of input.rows) {
    assertMonth(row.observationDate);
    if (!Number.isFinite(row.value)) {
      throw new Error(
        `BLS CPI snapshot contains a non-finite value for ${row.observationDate}.`
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
        `BLS CPI published snapshot ${input.snapshot.label}`
      )
    );
  }

  return results;
}
