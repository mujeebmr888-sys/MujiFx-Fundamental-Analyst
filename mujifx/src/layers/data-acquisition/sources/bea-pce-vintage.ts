/**
 * BEA PCE PRICE INDEX PUBLISHED-SNAPSHOT VINTAGE ADAPTER
 *
 * BEA publishes Personal Income and Outlays data and GDP products with
 * release/version context. This adapter accepts rows parsed from an exact
 * BEA published snapshot and refuses to treat a live API retrieval as a
 * point-in-time vintage.
 */

import type { IndicatorId } from "@/types/economic-data";
import {
  blsPublishedSnapshotProvenance,
  type BlsPublishedSnapshotDescriptor,
} from "@/layers/data-acquisition/sources/bls-snapshot-provenance";
import { writeAuthoritativeVintage } from "@/layers/historical-database/authoritative-vintage-writer";

/**
 * BEA NIPA Table 2.4.4U / related published PCE price-index concepts:
 * DPCERG = PCE price index; DPCCRG = PCE excluding food and energy.
 */
export type BeaPceSeries = "DPCERG" | "DPCCRG";

export interface BeaPceSnapshotRow {
  observationDate: string;
  value: number;
  isMissing?: boolean;
}

export interface WriteBeaPceSnapshotInput {
  seriesCode: BeaPceSeries;
  indicator: Extract<IndicatorId, "PCE" | "CORE_PCE">;
  sourceName: string;
  sourceUrl: string;
  sourceTier: "TIER_1_OFFICIAL";
  retrievedAt: string;
  snapshot: BlsPublishedSnapshotDescriptor;
  rows: BeaPceSnapshotRow[];
}

function assertMonth(value: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error(`BEA PCE observationDate must be YYYY-MM: ${value}`);
  }
}

function expectedSeries(indicator: WriteBeaPceSnapshotInput["indicator"]): BeaPceSeries {
  return indicator === "PCE" ? "DPCERG" : "DPCCRG";
}

/**
 * Persist one exact BEA PCE/Core PCE published snapshot as point-in-time
 * observations. The supplied publication date is the version evidence.
 */
export async function writeBeaPceSnapshot(
  input: WriteBeaPceSnapshotInput
): Promise<unknown[]> {
  if (!input.rows.length) {
    throw new Error("BEA PCE snapshot contains no observations.");
  }

  if (input.seriesCode !== expectedSeries(input.indicator)) {
    throw new Error(
      `BEA PCE series ${input.seriesCode} does not match indicator ${input.indicator}.`
    );
  }

  const provenance = blsPublishedSnapshotProvenance(input.snapshot);
  const results: unknown[] = [];

  for (const row of input.rows) {
    assertMonth(row.observationDate);
    if (!Number.isFinite(row.value)) {
      throw new Error(
        `BEA PCE snapshot contains a non-finite value for ${row.observationDate}.`
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
        `BEA ${input.indicator} published snapshot ${input.snapshot.label}`
      )
    );
  }

  return results;
}
