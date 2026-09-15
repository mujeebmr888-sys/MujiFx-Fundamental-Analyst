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

function validate(descriptor: BlsPublishedSnapshotDescriptor): void {
  if (!descriptor.snapshotUrl.trim()) {
    throw new Error("BLS snapshot URL is required.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(descriptor.publicationDate)) {
    throw new Error("BLS snapshot publicationDate must be YYYY-MM-DD.");
  }
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
 * Reserved for BLS artifacts whose documentation explicitly preserves the
 * information set as published at a release point (for example CES vintage
 * tables). Callers must use this only for such source-specific evidence.
 */
export function blsExplicitVintageProvenance(
  descriptor: BlsPublishedSnapshotDescriptor
): AuthoritativeVersionProvenance {
  validate(descriptor);
  return {
    evidence: "EXPLICIT_SOURCE_VERSION",
    sourceVersion: descriptor.publicationDate,
    sourceVersionLabel: descriptor.label.trim(),
    snapshotUrl: descriptor.snapshotUrl.trim(),
    availableFrom: descriptor.publicationDate,
    availableUntil: null,
    vintageEligible: true,
  };
}
