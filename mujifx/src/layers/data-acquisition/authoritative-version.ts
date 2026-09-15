/**
 * AUTHORITATIVE VERSION / VINTAGE PROVENANCE CONTRACT
 *
 * A retrieval timestamp is not a source vintage. A point-in-time observation
 * may only be archived when the official source gives us an explicit version
 * or a published snapshot that represents the information set at a known
 * release/publication point.
 */

export type AuthoritativeVersionEvidence =
  | "EXPLICIT_SOURCE_VERSION"
  | "PUBLISHED_SNAPSHOT"
  | "API_RETRIEVAL_ONLY";

export interface AuthoritativeVersionProvenance {
  evidence: AuthoritativeVersionEvidence;
  sourceVersion: string | null;
  sourceVersionLabel: string | null;
  snapshotUrl: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
}

/**
 * BLS Public Data API responses contain published observations but do not
 * expose an immutable revision/vintage identifier for those observations.
 * Keep the retrieval timestamp for audit purposes, but do not promote it to
 * sourceVersion and do not send API-only results into vintage storage.
 */
export function blsApiRetrievalProvenance(): AuthoritativeVersionProvenance {
  return {
    evidence: "API_RETRIEVAL_ONLY",
    sourceVersion: null,
    sourceVersionLabel: null,
    snapshotUrl: null,
    availableFrom: null,
    availableUntil: null,
  };
}

/**
 * Guard used by future version-aware ingestion paths. This deliberately
 * rejects current API reads and prevents accidental fake vintages.
 */
export function assertVintageEligible(
  provenance: AuthoritativeVersionProvenance,
  context: string
): asserts provenance is AuthoritativeVersionProvenance & {
  evidence: "EXPLICIT_SOURCE_VERSION" | "PUBLISHED_SNAPSHOT";
  sourceVersion: string;
} {
  if (
    (provenance.evidence !== "EXPLICIT_SOURCE_VERSION" &&
      provenance.evidence !== "PUBLISHED_SNAPSHOT") ||
    !provenance.sourceVersion?.trim()
  ) {
    throw new Error(
      `Vintage ingestion blocked for ${context}: authoritative source does not provide a versioned snapshot.`
    );
  }
}
