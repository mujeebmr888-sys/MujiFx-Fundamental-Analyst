/**
 * Versioned vintage acquisition primitives.
 *
 * Safe compatibility layer for the old vintage-pilot route. FRED/ALFRED
 * archival acquisition is disabled for production; authoritative sources
 * must provide their own permitted version metadata.
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

export type VersionedVintageInput = Omit<VintageObservation, "realtimeEnd"> & { realtimeEnd?: string | null };

export function validateVersionedVintage(input: VersionedVintageInput): VintageObservation {
  if (!input.sourceVersion?.trim()) throw new Error(`Refusing vintage ${input.indicator}/${input.observationDate}: sourceVersion is required.`);
  if (!input.realtimeStart?.trim()) throw new Error(`Refusing vintage ${input.indicator}/${input.observationDate}: realtimeStart is required.`);
  if (!input.retrievedAt?.trim()) throw new Error(`Refusing vintage ${input.indicator}/${input.observationDate}: retrievedAt is required.`);
  if (!input.sourceName?.trim() || !input.sourceUrl?.trim()) throw new Error(`Refusing vintage ${input.indicator}/${input.observationDate}: source provenance is incomplete.`);
  if (input.value !== null && !Number.isFinite(input.value)) throw new Error(`Refusing vintage ${input.indicator}/${input.observationDate}: value is not finite.`);
  return { ...input, sourceVersion: input.sourceVersion.trim(), realtimeEnd: input.realtimeEnd ?? null };
}

/** Deprecated compatibility exports. They fail closed and never query FRED. */
export async function discoverVintageDates(_indicator: IndicatorId): Promise<string[]> {
  throw new Error("FRED/ALFRED vintage discovery is disabled; use an authoritative versioned source.");
}

export async function fetchObservationAtVintage(
  _indicator: IndicatorId,
  _vintageDate: string,
  _observationStart?: string,
  _observationEnd?: string
): Promise<VintageObservation[]> {
  throw new Error("FRED/ALFRED vintage fetching is disabled; use an authoritative versioned source.");
}
