/**
 * Vintage-history database access for Step 13G.
 *
 * Writes go through the narrow Supabase/Postgres RPC so closing the previous
 * open vintage and inserting the new vintage happen in one transaction.
 */

import { supabaseAdmin } from "@/config/supabase-admin";
import type { VintageObservation } from "@/layers/data-acquisition/sources/fred-vintage";

export interface VintageObservationAsOf {
  id: number;
  indicator: string;
  observation_date: string;
  value: number | null;
  is_missing: boolean;
  realtime_start: string;
  realtime_end: string | null;
  retrieved_at: string;
  source_name: string;
  source_url: string;
  source_tier: string;
  source_version: string | null;
}

export async function saveVintageObservation(vintage: VintageObservation) {
  if (!vintage.sourceVersion?.trim()) {
    throw new Error(
      `Refusing to save vintage ${vintage.indicator}/${vintage.observationDate}: sourceVersion is required.`
    );
  }

  const { data, error } = await supabaseAdmin.rpc(
    "save_indicator_observation_vintage",
    {
      p_indicator: vintage.indicator,
      p_observation_date: vintage.observationDate,
      p_value: vintage.value,
      p_is_missing: vintage.isMissing,
      p_realtime_start: vintage.realtimeStart,
      p_retrieved_at: vintage.retrievedAt,
      p_source_name: vintage.sourceName,
      p_source_url: vintage.sourceUrl,
      p_source_tier: vintage.sourceTier,
      p_source_version: vintage.sourceVersion.trim(),
    }
  );

  if (error) {
    throw new Error(
      `Failed to save vintage ${vintage.indicator}/${vintage.observationDate}/${vintage.realtimeStart}: ${error.message}`
    );
  }

  return data;
}

/**
 * Save many authoritative vintage observations in one database RPC.
 * This avoids one network round trip per observation while keeping the
 * transactional vintage close/insert semantics inside Postgres.
 */
export async function saveVintageObservations(vintages: VintageObservation[]) {
  if (!vintages.length) return [];
  if (vintages.length > 5000) {
    throw new Error("Vintage batch cannot exceed 5000 observations.");
  }

  for (const vintage of vintages) {
    if (!vintage.sourceVersion?.trim()) {
      throw new Error(
        `Refusing to save vintage ${vintage.indicator}/${vintage.observationDate}: sourceVersion is required.`
      );
    }
  }

  const { data, error } = await supabaseAdmin.rpc(
    "save_indicator_observation_vintage_batch",
    {
      p_rows: vintages.map((vintage) => ({
        indicator: vintage.indicator,
        observation_date: vintage.observationDate,
        value: vintage.value,
        is_missing: vintage.isMissing,
        realtime_start: vintage.realtimeStart,
        retrieved_at: vintage.retrievedAt,
        source_name: vintage.sourceName,
        source_url: vintage.sourceUrl,
        source_tier: vintage.sourceTier,
        source_version: vintage.sourceVersion.trim(),
      })),
    }
  );

  if (error) {
    throw new Error(`Failed to save vintage batch: ${error.message}`);
  }

  return (data ?? []) as unknown[];
}

/**
 * Returns the single observation version that was officially available on
 * the requested as-of date. This is the core read path for point-in-time
 * analysis and deliberately does not fall back to the current/latest value.
 */
export async function getVintageObservationAsOf(
  indicator: string,
  observationDate: string,
  asOfDate: string
): Promise<VintageObservationAsOf | null> {
  const { data, error } = await supabaseAdmin.rpc(
    "get_indicator_vintage_as_of",
    {
      p_indicator: indicator,
      p_observation_date: observationDate,
      p_as_of_date: asOfDate,
    }
  );

  if (error) {
    throw new Error(
      `Failed to read vintage ${indicator}/${observationDate} as of ${asOfDate}: ${error.message}`
    );
  }

  const rows = (data ?? []) as VintageObservationAsOf[];
  return rows[0] ?? null;
}
