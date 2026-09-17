/**
 * AUTHORITATIVE VERSION-AWARE VINTAGE WRITER
 *
 * This is the only bridge from an authoritative published snapshot into the
 * point-in-time vintage table. A normal API retrieval is intentionally not
 * accepted as vintage evidence.
 */

import {
  assertVintageEligible,
  type AuthoritativeVersionProvenance,
} from "@/layers/data-acquisition/authoritative-version";
import {
  saveVintageObservation,
  saveVintageObservations,
} from "@/layers/historical-database/vintage-database";
import {
  validateVersionedVintage,
  type VersionedVintageInput,
} from "@/layers/data-acquisition/sources/fred-vintage";

export interface AuthoritativeVintageInput
  extends Omit<VersionedVintageInput, "sourceVersion" | "realtimeStart"> {
  /** The official publication/version date of the snapshot. */
  realtimeStart?: string;
  provenance: AuthoritativeVersionProvenance;
}

function toValidatedVintage(
  input: AuthoritativeVintageInput,
  context: string
) {
  assertVintageEligible(input.provenance, context);

  const realtimeStart = input.realtimeStart ?? input.provenance.availableFrom;
  if (!realtimeStart) {
    throw new Error(
      `Vintage ingestion blocked for ${context}: no authoritative availability date was supplied.`
    );
  }

  return validateVersionedVintage({
    indicator: input.indicator,
    observationDate: input.observationDate,
    value: input.value,
    isMissing: input.isMissing,
    realtimeStart,
    retrievedAt: input.retrievedAt,
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    sourceTier: input.sourceTier,
    sourceVersion: input.provenance.sourceVersion,
    realtimeEnd: input.realtimeEnd ?? null,
  });
}

/**
 * Write one observation from an explicitly versioned authoritative source.
 */
export async function writeAuthoritativeVintage(
  input: AuthoritativeVintageInput,
  context: string
) {
  return saveVintageObservation(toValidatedVintage(input, context));
}

/**
 * Write many observations from an explicitly versioned authoritative source
 * in one Supabase/Postgres RPC. This is the production path for large
 * published snapshot tables such as the BLS NFP revisions triangle.
 */
export async function writeAuthoritativeVintageBatch(
  inputs: AuthoritativeVintageInput[],
  context: string
) {
  if (!inputs.length) return [];

  const vintages = inputs.map((input) => toValidatedVintage(input, context));
  return saveVintageObservations(vintages);
}
