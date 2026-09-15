/**
 * FEDERAL RESERVE H.15 EFFECTIVE FEDERAL FUNDS PUBLISHED-SNAPSHOT ADAPTER
 *
 * The live H.15 feed is authoritative for current observations, but a
 * point-in-time vintage must be tied to an exact published H.15 snapshot.
 */

import type { IndicatorId } from "@/types/economic-data";
import {
  federalReservePublishedSnapshotProvenance,
  type FederalReservePublishedSnapshotDescriptor,
} from "@/layers/data-acquisition/sources/federal-reserve-snapshot-provenance";
import { assertFiniteSnapshotRows } from "@/layers/data-acquisition/sources/published-snapshot-validation";
import { writeAuthoritativeVintage } from "@/layers/historical-database/authoritative-vintage-writer";

export interface FedFundsSnapshotRow {
  observationDate: string;
  value: number;
  isMissing?: boolean;
}

export interface WriteFedFundsSnapshotInput {
  seriesId: "RIFSPFF_N.M";
  indicator: Extract<IndicatorId, "FED_FUNDS_RATE">;
  sourceName: string;
  sourceUrl: string;
  sourceTier: "TIER_1_OFFICIAL";
  retrievedAt: string;
  snapshot: FederalReservePublishedSnapshotDescriptor;
  rows: FedFundsSnapshotRow[];
}

function assertMonth(value: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error(`Federal Reserve funds observationDate must be YYYY-MM: ${value}`);
  }
}

export async function writeFedFundsSnapshot(
  input: WriteFedFundsSnapshotInput
): Promise<unknown[]> {
  assertFiniteSnapshotRows(input.rows, "Federal Reserve funds");

  if (input.indicator !== "FED_FUNDS_RATE" || input.seriesId !== "RIFSPFF_N.M") {
    throw new Error(
      `Federal Reserve series ${input.seriesId} does not match indicator ${input.indicator}.`
    );
  }

  const provenance = federalReservePublishedSnapshotProvenance(input.snapshot);
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
        `Federal Reserve H.15 effective funds published snapshot ${input.snapshot.label}`
      )
    );
  }

  return results;
}
