/**
 * AUTHORITATIVE VERSION / VINTAGE PROVENANCE CONTRACT
 *
 * A retrieval timestamp is not a source vintage. A point-in-time observation
 * may only be archived when the official source gives us an explicit version
 * or a published source artifact that is explicitly known to preserve the
 * information set at that release point.
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
  /** True only when the source artifact is suitable for point-in-time vintage storage. */
  vintageEligible: boolean;
}

export function blsApiRetrievalProvenance(): AuthoritativeVersionProvenance {
  return {
    evidence: "API_RETRIEVAL_ONLY",
    sourceVersion: null,
    sourceVersionLabel: null,
    snapshotUrl: null,
    availableFrom: null,
    availableUntil: null,
    vintageEligible: false,
  };
}

/**
 * Guard used by version-aware ingestion paths. A published snapshot is not
 * automatically a vintage: the source must explicitly support preserving the
 * information set represented by that snapshot.
 */
export function assertVintageEligible(
  provenance: AuthoritativeVersionProvenance,
  context: string
): asserts provenance is AuthoritativeVersionProvenance & {
  evidence: "EXPLICIT_SOURCE_VERSION" | "PUBLISHED_SNAPSHOT";
  sourceVersion: string;
  vintageEligible: true;
} {
  if (
    (provenance.evidence !== "EXPLICIT_SOURCE_VERSION" &&
      provenance.evidence !== "PUBLISHED_SNAPSHOT") ||
    !provenance.sourceVersion?.trim() ||
    provenance.vintageEligible !== true
  ) {
    throw new Error(
      `Vintage ingestion blocked for ${context}: authoritative source does not provide an explicitly vintage-eligible versioned snapshot.`
    );
  }
}
