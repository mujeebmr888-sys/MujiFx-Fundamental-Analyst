/**
 * Shared validation for already-parsed authoritative published snapshots.
 *
 * This layer does not decide whether a source is a true vintage. Provenance
 * eligibility is handled separately by authoritative-version.ts.
 */

export interface PublishedSnapshotRow {
  observationDate: string;
  value: number;
  isMissing?: boolean;
}

export function assertFiniteSnapshotRows<T extends PublishedSnapshotRow>(
  rows: T[],
  label: string
): void {
  if (!rows.length) {
    throw new Error(`${label} snapshot contains no observations.`);
  }

  const seen = new Set<string>();
  for (const row of rows) {
    const observationDate = row.observationDate.trim();
    if (!observationDate) {
      throw new Error(`${label} snapshot observationDate is required.`);
    }
    if (seen.has(observationDate)) {
      throw new Error(`Duplicate ${label} observationDate: ${observationDate}`);
    }
    seen.add(observationDate);
    if (row.isMissing !== true && !Number.isFinite(row.value)) {
      throw new Error(
        `${label} snapshot contains a non-finite value for ${observationDate}.`
      );
    }
  }
}

export function assertSnapshotPublicationDate(
  publicationDate: string,
  label: string
): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publicationDate)) {
    throw new Error(`${label} snapshot publicationDate must be YYYY-MM-DD.`);
  }

  const parsed = new Date(`${publicationDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} snapshot publicationDate is invalid: ${publicationDate}`);
  }
}
