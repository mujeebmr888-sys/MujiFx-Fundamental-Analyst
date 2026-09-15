/**
 * BLS PUBLISHED SNAPSHOT PROVENANCE
 *
 * Ordinary archived BLS snapshot files can be revised later. They are useful
 * published artifacts, but are not automatically immutable point-in-time
 * vintages. CES vintage tables have stronger release-by-release provenance
 * and use the explicit vintage helper below.
 */

import type { AuthoritativeVersionProvenance } from "@/layers/data-acquisition/authoritative-version";

export interface BlsPublishedSnapshotDescriptor {
  snapshotUrl: string;
  publicationDate: string;
  label: string;
}

function assertIsoDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`BLS snapshot ${field} must be YYYY-MM-DD.`);
  }
}

function validate(descriptor: BlsPublishedSnapshotDescriptor): void {
  if (!descriptor.snapshotUrl.trim()) {
    throw new Error("BLS snapshot URL is required.");
  }
  assertIsoDate(descriptor.publicationDate, "publicationDate");
  if (!descriptor.label.trim()) {
    throw new Error("BLS snapshot label is required.");
  }
}

/** Ordinary BLS published artifact; NOT sufficient for vintage storage. */
export function blsPublishedSnapshotProvenance(
  descriptor: BlsPublishedSnapshotDescriptor
): AuthoritativeVersionProvenance {
  validate(descriptor);
  return {
    evidence: "PUBLISHED_SNAPSHOT",
    sourceVersion: descriptor.publicationDate,
    sourceVersionLabel: descriptor.label.trim(),
    snapshotUrl: descriptor.snapshotUrl.trim(),
    availableFrom: descriptor.publicationDate,
    availableUntil: null,
    vintageEligible: false,
  };
}

/**
 * CES vintage-table provenance. The release date is per observation because
 * one official vintage table contains many publication releases for the same
 * reference month. The table artifact URL is audit provenance; releaseDate is
 * the actual point-in-time version key.
 */
export function blsExplicitVintageProvenance(
  descriptor: BlsPublishedSnapshotDescriptor,
  releaseDate: string
): AuthoritativeVersionProvenance {
  validate(descriptor);
  assertIsoDate(releaseDate, "releaseDate");
  return {
    evidence: "EXPLICIT_SOURCE_VERSION",
    sourceVersion: releaseDate,
    sourceVersionLabel: `${descriptor.label.trim()} release ${releaseDate}`,
    snapshotUrl: descriptor.snapshotUrl.trim(),
    availableFrom: releaseDate,
    availableUntil: null,
    vintageEligible: true,
  };
}
