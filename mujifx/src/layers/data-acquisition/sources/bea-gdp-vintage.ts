/**
 * BEA REAL GDP PUBLISHED-SNAPSHOT VINTAGE ADAPTER
 *
 * Accepts quarterly real-GDP growth rows parsed from an exact BEA published
 * GDP release/vintage snapshot. The BEA-published annualized rate is stored
 * as-is; MUJIFX must not re-annualize it.
 */

import type { IndicatorId } from "@/types/economic-data";
import {
  beaPublishedSnapshotProvenance,
  type BeaPublishedSnapshotDescriptor,
} from "@/layers/data-acquisition/sources/bea-snapshot-provenance";
import { writeAuthoritativeVintage } from "@/layers/historical-database/authoritative-vintage-writer";

export interface BeaGdpSnapshotRow {
  observationDate: string;
  value: number;
  isMissing?: boolean;
}

export interface WriteBeaGdpSnapshotInput {
  tableId: "T10101";
  lineCode: "1";
  indicator: Extract<IndicatorId, "GDP_GROWTH_RATE">;
  sourceName: string;
  sourceUrl: string;
  sourceTier: "TIER_1_OFFICIAL";
  retrievedAt: string;
  snapshot: BeaPublishedSnapshotDescriptor;
  rows: BeaGdpSnapshotRow[];
}

function assertQuarter(value: string): void {
  if (!/^\d{4}-Q[1-4]$/.test(value)) {
    throw new Error(`BEA GDP observationDate must be YYYY-Q1..Q4: ${value}`);
  }
}

export async function writeBeaGdpSnapshot(
  input: WriteBeaGdpSnapshotInput
): Promise<unknown[]> {
  if (!input.rows.length) {
    throw new Error("BEA GDP snapshot contains no observations.");
  }

  if (input.tableId !== "T10101" || input.lineCode !== "1") {
    throw new Error("BEA GDP growth must use NIPA T10101 line 1.");
  }

  const provenance = beaPublishedSnapshotProvenance(input.snapshot);
  const results: unknown[] = [];

  for (const row of input.rows) {
    assertQuarter(row.observationDate);
    if (!Number.isFinite(row.value)) {
      throw new Error(
        `BEA GDP snapshot contains a non-finite value for ${row.observationDate}.`
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
        `BEA GDP growth published snapshot ${input.snapshot.label}`
      )
    );
  }

  return results;
}
