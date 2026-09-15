/**
 * AUTHORITATIVE INGESTION WRITER
 *
 * Shared server-side bridge from official-source adapters into Supabase.
 *
 * IMPORTANT:
 * - Observation date is NEVER used as release date.
 * - release_date is only populated when the official source explicitly
 *   provides/verifies the release date.
 * - Verified release dates also create point-in-time vintages.
 * - FRED/ALFRED is not used by this writer for archival storage.
 */

import { supabaseAdmin } from "@/config/supabase-admin";
import type { IndicatorId } from "@/types/economic-data";
import { saveVintageObservation } from "@/layers/historical-database/vintage-database";

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

function normalizePeriodCovered(periodCovered: string): string {
  const normalized = periodCovered.trim();
  if (/^\d{4}-\d{2}$/.test(normalized)) return `${normalized}-01`;
  return normalized;
}

function validateObservation(observation: AuthoritativeObservation): void {
  if (!observation.periodCovered?.trim()) {
    throw new Error(`Missing periodCovered for ${observation.indicator}.`);
  }
  if (!Number.isFinite(observation.actual)) {
    throw new Error(`Invalid actual value for ${observation.indicator}.`);
  }
  if (!observation.sourceName?.trim()) {
    throw new Error(`Missing sourceName for ${observation.indicator}.`);
  }
  if (!observation.sourceUrl?.trim()) {
    throw new Error(`Missing sourceUrl for ${observation.indicator}.`);
  }
  if (!observation.retrievedAt?.trim()) {
    throw new Error(`Missing retrievedAt for ${observation.indicator}.`);
  }
  if (observation.sourceReleaseDateVerified === true && !observation.sourceReleaseDate) {
    throw new Error(
      `sourceReleaseDateVerified cannot be true without sourceReleaseDate for ${observation.indicator}.`
    );
  }
}

/**
 * Writes one authoritative observation into the CURRENT data plane and,
 * when an official release date is verified, the POINT-IN-TIME data plane.
 *
 * A vintage is never created without a verified information/release date.
 * This prevents observation dates from being incorrectly treated as
 * publication dates and prevents later revisions from masquerading as
 * historical initial releases.
 */
export async function writeAuthoritativeObservation(
  observation: AuthoritativeObservation
) {
  validateObservation(observation);

  const periodCovered = normalizePeriodCovered(observation.periodCovered);

  const row = {
    indicator: observation.indicator,
    release_date:
      observation.sourceReleaseDateVerified === true
        ? observation.sourceReleaseDate ?? null
        : null,
    period_covered: periodCovered,
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
    data_origin: getDataOrigin(observation.sourceName),
  };

  const { data, error } = await supabaseAdmin
    .from("economic_data_points")
    .upsert(row, { onConflict: "indicator,period_covered" })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to write ${observation.indicator}: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Authoritative write returned no row for ${observation.indicator}.`);
  }

  if (observation.sourceReleaseDateVerified && observation.sourceReleaseDate) {
    await saveVintageObservation({
      indicator: observation.indicator,
      observationDate: periodCovered,
      value: observation.actual,
      isMissing: false,
      realtimeStart: observation.sourceReleaseDate,
      retrievedAt: observation.retrievedAt,
      sourceName: observation.sourceName,
      sourceUrl: observation.sourceUrl,
      sourceTier: observation.sourceTier,
    });
  }

  return data;
}

function getDataOrigin(sourceName: string): string {
  const normalized = sourceName.toLowerCase();
  if (normalized.includes("bls")) return "authoritative_bls";
  if (normalized.includes("bea")) return "authoritative_bea";
  if (normalized.includes("federal reserve") || normalized.includes("federalreserve")) {
    return "authoritative_fed";
  }
  if (normalized.includes("treasury")) return "authoritative_treasury";
  if (normalized.includes("census")) return "authoritative_census";
  if (normalized.includes("department of labor") || normalized.includes("dol") || normalized.includes("eta")) {
    return "authoritative_dol";
  }
  if (normalized.includes("cboe")) return "authoritative_cboe";
  return "authoritative_official";
}

/**
 * Writes a batch and records an ingestion audit row.
 * If one observation fails, remaining observations are still attempted.
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

    results.push({ sourceName, indicator, rowsSeen: items.length, rowsWritten, status });
  }

  return results;
}
