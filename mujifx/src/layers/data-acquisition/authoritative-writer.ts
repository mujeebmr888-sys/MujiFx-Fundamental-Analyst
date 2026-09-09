/**
 * AUTHORITATIVE INGESTION WRITER
 *
 * Shared server-side bridge from official-source adapters into Supabase.
 * This module deliberately keeps release metadata honest: an observation
 * date is never promoted to a release date unless the source explicitly
 * supplies/establishes that metadata.
 */

import { supabaseAdmin } from "@/config/supabase-admin";
import type { IndicatorId } from "@/types/economic-data";

export interface AuthoritativeObservation {
  indicator: IndicatorId;
  periodCovered: string;
  actual: number;
  unit: string;
  sourceName: string;
  sourceUrl: string;
  sourceTier: "TIER_1_OFFICIAL";
  sourceObservationId?: string | null;
  sourceReleaseDate?: string | null;
  sourceReleaseDateVerified?: boolean;
  retrievedAt: string;
  previous?: number | null;
}

export interface AuthoritativeIngestionResult {
  sourceName: string;
  indicator: IndicatorId;
  rowsSeen: number;
  rowsWritten: number;
  status: "success" | "partial";
}

function validateObservation(observation: AuthoritativeObservation): void {
  if (!observation.periodCovered) {
    throw new Error(`Missing periodCovered for ${observation.indicator}.`);
  }
  if (!Number.isFinite(observation.actual)) {
    throw new Error(`Invalid actual value for ${observation.indicator}.`);
  }
  if (!observation.sourceName || !observation.sourceUrl) {
    throw new Error(`Missing source metadata for ${observation.indicator}.`);
  }
  if (observation.sourceReleaseDateVerified && !observation.sourceReleaseDate) {
    throw new Error(
      `sourceReleaseDateVerified cannot be true without sourceReleaseDate for ${observation.indicator}.`
    );
  }
}

/**
 * Writes one official-source observation. The existing legacy release_date
 * field is retained for compatibility and is intentionally set to the
 * observation period date only when it is already required by the schema;
 * authoritative release metadata lives in source_release_date.
 */
export async function writeAuthoritativeObservation(
  observation: AuthoritativeObservation
) {
  validateObservation(observation);

  const observationDate = `${observation.periodCovered}-01`;

  const row = {
    indicator: observation.indicator,
    release_date: observation.sourceReleaseDate ?? observationDate,
    period_covered: observation.periodCovered,
    previous: observation.previous ?? null,
    consensus_forecast: null,
    mujifx_estimate: null,
    actual: observation.actual,
    unit: observation.unit,
    available: true,
    unavailable_reason: null,
    source_name: observation.sourceName,
    source_url: observation.sourceUrl,
    source_tier: observation.sourceTier,
    retrieved_at: observation.retrievedAt,
    source_release_date: observation.sourceReleaseDate ?? null,
    source_release_date_verified: observation.sourceReleaseDateVerified ?? false,
    source_observation_id: observation.sourceObservationId ?? null,
    data_origin: observation.sourceName.toLowerCase().includes("bls")
      ? "authoritative_bls"
      : observation.sourceName.toLowerCase().includes("bea")
        ? "authoritative_bea"
        : observation.sourceName.toLowerCase().includes("federal reserve")
          ? "authoritative_fed"
          : "authoritative_official",
  };

  const { data, error } = await supabaseAdmin
    .from("economic_data_points")
    .upsert(row, { onConflict: "indicator,period_covered" })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to write ${observation.indicator}: ${error.message}`);
  }

  return data;
}

/**
 * Writes a batch and records an ingestion audit row. If one observation fails,
 * the remaining observations are attempted and the run becomes partial.
 */
export async function writeAuthoritativeBatch(
  sourceName: string,
  observations: AuthoritativeObservation[]
): Promise<AuthoritativeIngestionResult[]> {
  const grouped = new Map<IndicatorId, AuthoritativeObservation[]>();
  for (const observation of observations) {
    const existing = grouped.get(observation.indicator) ?? [];
    existing.push(observation);
    grouped.set(observation.indicator, existing);
  }

  const results: AuthoritativeIngestionResult[] = [];

  for (const [indicator, items] of grouped) {
    const startedAt = new Date().toISOString();
    let rowsWritten = 0;
    let firstError: string | null = null;

    for (const item of items) {
      try {
        await writeAuthoritativeObservation(item);
        rowsWritten += 1;
      } catch (error) {
        if (!firstError) {
          firstError = error instanceof Error ? error.message : String(error);
        }
      }
    }

    const status = rowsWritten === items.length ? "success" : "partial";

    const { error: auditError } = await supabaseAdmin
      .from("authoritative_ingestion_runs")
      .insert({
        source_name: sourceName,
        indicator,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        status,
        rows_seen: items.length,
        rows_written: rowsWritten,
        error_message: firstError,
      });

    if (auditError) {
      throw new Error(
        `Ingestion succeeded but audit write failed for ${indicator}: ${auditError.message}`
      );
    }

    results.push({
      sourceName,
      indicator,
      rowsSeen: items.length,
      rowsWritten,
      status,
    });
  }

  return results;
}
