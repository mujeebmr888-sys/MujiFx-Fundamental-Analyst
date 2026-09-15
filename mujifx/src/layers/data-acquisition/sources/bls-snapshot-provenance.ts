/**
 * BLS PUBLISHED SNAPSHOT PROVENANCE
 *
 * BLS publishes monthly CPI supplemental files and archived yearly files.
 * These are distinct from the live Public Data API: the snapshot itself is
 * the version evidence. We keep the publication date explicit and never use
 * retrieval time as the version.
 */

import type { AuthoritativeVersionProvenance } from "@/layers/data-acquisition/authoritative-version";

export interface BlsPublishedSnapshotDescriptor {
  snapshotUrl: string;
  publicationDate: string;
  label: string;
}

function assertIsoDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must be an ISO calendar date (YYYY-MM-DD).`);
  }
}

/**
 * Creates provenance for a BLS file that was actually published by BLS.
 * The caller must supply the official snapshot URL and publication date.
 */
export function blsPublishedSnapshotProvenance(
  descriptor: BlsPublishedSnapshotDescriptor
): AuthoritativeVersionProvenance {
  if (!descriptor.snapshotUrl.trim()) {
    throw new Error("BLS snapshot URL is required.");
  }
  assertIsoDate(descriptor.publicationDate, "BLS snapshot publicationDate");
  if (!descriptor.label.trim()) {
    throw new Error("BLS snapshot label is required.");
  }

  return {
    evidence: "PUBLISHED_SNAPSHOT",
    sourceVersion: descriptor.publicationDate,
    sourceVersionLabel: descriptor.label.trim(),
    snapshotUrl: descriptor.snapshotUrl.trim(),
    availableFrom: descriptor.publicationDate,
    availableUntil: null,
  };
}
