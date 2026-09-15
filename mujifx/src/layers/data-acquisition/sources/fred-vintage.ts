/**
 * Versioned vintage acquisition primitives.
 *
 * This module may only be used when the upstream source response explicitly
 * identifies the information set/version being stored. A request date or
 * release-calendar date is never promoted into a vintage version by inference.
 */

import type { IndicatorId } from "@/types/economic-data";

export type VintageObservation = {
  indicator: IndicatorId;
  observationDate: string;
  value: number | null;
  isMissing: boolean;
  realtimeStart: string;
  realtimeEnd: string | null;
  retrievedAt: string;
  sourceName: string;
  sourceUrl: string;
  sourceTier: "TIER_1_OFFICIAL";
  sourceVersion: string;
};

export type VersionedVintageInput = Omit<VintageObservation, "realtimeEnd"> & {
  realtimeEnd?: string | null;
};

/**
 * Guard used by authoritative vintage ingestion before persistence.
 * sourceVersion must come from the source/file/version metadata itself.
 */
export function validateVersionedVintage(input: VersionedVintageInput): VintageObservation {
  if (!input.sourceVersion?.trim()) {
    throw new Error(
      `Refusing vintage ${input.indicator}/${input.observationDate}: sourceVersion is required.`
    );
  }

  if (!input.realtimeStart?.trim()) {
    throw new Error(
      `Refusing vintage ${input.indicator}/${input.observationDate}: realtimeStart is required.`
    );
  }

  if (!input.retrievedAt?.trim()) {
    throw new Error(
      `Refusing vintage ${input.indicator}/${input.observationDate}: retrievedAt is required.`
    );
  }

  if (!input.sourceName?.trim() || !input.sourceUrl?.trim()) {
    throw new Error(
      `Refusing vintage ${input.indicator}/${input.observationDate}: source provenance is incomplete.`
    );
  }

  if (input.value !== null && !Number.isFinite(input.value)) {
    throw new Error(
      `Refusing vintage ${input.indicator}/${input.observationDate}: value is not finite.`
    );
  }

  return {
    ...input,
    sourceVersion: input.sourceVersion.trim(),
    realtimeEnd: input.realtimeEnd ?? null,
  };
}
