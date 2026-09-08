/**
 * Vintage-history database access for Step 13G.
 *
 * Writes go through the narrow Supabase/Postgres RPC so closing the previous
 * open vintage and inserting the new vintage happen in one transaction.
 */

import { supabaseAdmin } from "@/config/supabase-admin";
import type { VintageObservation } from "@/layers/data-acquisition/sources/fred-vintage";

export async function saveVintageObservation(vintage: VintageObservation) {
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
    }
  );

  if (error) {
    throw new Error(
      `Failed to save vintage ${vintage.indicator}/${vintage.observationDate}/${vintage.realtimeStart}: ${error.message}`
    );
  }

  return data;
}
