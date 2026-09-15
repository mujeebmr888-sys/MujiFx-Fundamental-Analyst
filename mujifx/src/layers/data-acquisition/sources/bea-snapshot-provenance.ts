/**
 * BEA PUBLISHED SNAPSHOT PROVENANCE
 *
 * A BEA publication artifact is useful source evidence, but it is not
 * automatically an immutable historical vintage. Vintage eligibility must be
 * established by a source-specific versioned artifact.
 */
import type { AuthoritativeVersionProvenance } from "@/layers/data-acquisition/authoritative-version";

export interface BeaPublishedSnapshotDescriptor {
  snapshotUrl: string;
  publicationDate: string;
  label: string;
}

export function beaPublishedSnapshotProvenance(
  descriptor: BeaPublishedSnapshotDescriptor
): AuthoritativeVersionProvenance {
  if (!descriptor.snapshotUrl.trim()) {
    throw new Error("BEA snapshot URL is required.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(descriptor.publicationDate)) {
    throw new Error("BEA snapshot publicationDate must be YYYY-MM-DD.");
  }
  if (!descriptor.label.trim()) {
    throw new Error("BEA snapshot label is required.");
  }

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
