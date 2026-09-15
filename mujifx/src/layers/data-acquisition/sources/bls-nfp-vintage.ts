/**
 * BLS CES TOTAL NONFARM PAYROLL VINTAGE ADAPTER
 *
 * BLS publishes official CES vintage tables containing employment values for
 * a reference month as published at each Employment Situation release.
 * A vintage row therefore needs BOTH the reference/observation month and the
 * release date that defines the point-in-time information set.
 */

import type { IndicatorId } from "@/types/economic-data";
import {
  blsExplicitVintageProvenance,
  type BlsPublishedSnapshotDescriptor,
} from "@/layers/data-acquisition/sources/bls-snapshot-provenance";
import { writeAuthoritativeVintage } from "@/layers/historical-database/authoritative-vintage-writer";

export interface BlsNfpSnapshotRow {
  observationDate: string;
  releaseDate: string;
  value: number;
  isMissing?: boolean;
}

function assertMonth(value: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error(`BLS NFP observationDate must be YYYY-MM: ${value}`);
  }
}

function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`BLS NFP releaseDate must be YYYY-MM-DD: ${value}`);
  }
}

function validateRows(rows: BlsNfpSnapshotRow[]): void {
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      throw new Error("BLS NFP vintage rows must be objects.");
    }
    if (typeof row.observationDate !== "string") {
      throw new Error("BLS NFP observationDate is required.");
    }
    if (typeof row.releaseDate !== "string") {
      throw new Error("BLS NFP releaseDate is required for point-in-time vintage storage.");
    }
    if (typeof row.value !== "number" || !Number.isFinite(row.value)) {
      throw new Error("BLS NFP vintage value must be finite.");
    }

    const observationDate = row.observationDate.trim();
    const releaseDate = row.releaseDate.trim();
    assertMonth(observationDate);
    assertDate(releaseDate);

    const key = `${observationDate}|${releaseDate}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate BLS NFP vintage row: ${key}`);
    }
    seen.add(key);
  }
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

  validateRows(input.rows);
  const results: unknown[] = [];

  for (const row of input.rows) {
    const provenance = blsExplicitVintageProvenance(
      input.snapshot,
      row.releaseDate.trim()
    );

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
          realtimeStart: row.releaseDate.trim(),
        },
        `BLS CES total nonfarm vintage ${input.snapshot.label} release ${row.releaseDate}`
      )
    );
  }

  return results;
}
