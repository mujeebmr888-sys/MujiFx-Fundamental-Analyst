import type { AuthoritativeVersionProvenance } from "@/layers/data-acquisition/authoritative-version";
import { assertSnapshotPublicationDate } from "@/layers/data-acquisition/sources/published-snapshot-validation";

export interface FederalReservePublishedSnapshotDescriptor {
  snapshotUrl: string;
  publicationDate: string;
  label: string;
}

export function federalReservePublishedSnapshotProvenance(
  descriptor: FederalReservePublishedSnapshotDescriptor
): AuthoritativeVersionProvenance {
  if (!descriptor.snapshotUrl.trim()) {
    throw new Error("Federal Reserve snapshot URL is required.");
  }
  assertSnapshotPublicationDate(descriptor.publicationDate, "Federal Reserve");
  if (!descriptor.label.trim()) {
    throw new Error("Federal Reserve snapshot label is required.");
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
