/**
 * GET /api/sync/backfill
 *
 * ONE-TIME / ON-DEMAND historical backfill — separate from the daily
 * /api/sync/all cron, which is completely unmodified and unaffected by
 * this route. Fetches deeper FRED history (per-indicator depth justified
 * in INDICATOR_BACKFILL_DEPTH, fred.ts) and saves each observation via
 * the EXISTING, unmodified saveDataPoint()/normalizeToRow() functions.
 *
 * Idempotent: relies entirely on the existing
 * `unique(indicator, period_covered)` constraint + saveDataPoint's
 * existing upsert — rerunning this route just updates the same rows,
 * never creates duplicates.
 *
 * Protected the same way as /api/sync/all — only Vercel's cron scheduler
 * (or someone who knows CRON_SECRET) can trigger it, since it makes many
 * FRED API calls.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  fetchHistoryFromFred,
  INDICATOR_BACKFILL_DEPTH,
} from "@/layers/data-acquisition/sources/fred";
import { normalizeToRow } from "@/layers/data-normalization/normalize";
import { saveDataPoint } from "@/layers/historical-database/database";
import type { IndicatorId } from "@/types/economic-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (process.env.CRON_SECRET && !isVercelCron) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{
    indicator: string;
    requestedDepth: number;
    fetched: number;
    saved: number;
    error?: string;
  }> = [];

  const entries = Object.entries(INDICATOR_BACKFILL_DEPTH) as Array<
    [IndicatorId, number]
  >;

  for (const [indicator, depth] of entries) {
    try {
      const points = await fetchHistoryFromFred(indicator, depth);

      let saved = 0;
      for (const point of points) {
        const row = normalizeToRow(point);
        await saveDataPoint(row);
        saved++;
      }

      results.push({
        indicator,
        requestedDepth: depth,
        fetched: points.length,
        saved,
      });
    } catch (err) {
      console.error(`Backfill failed for ${indicator}:`, err);
      results.push({
        indicator,
        requestedDepth: depth,
        fetched: 0,
        saved: 0,
        error: "See server logs for details.",
      });
    }
  }

  const totalSaved = results.reduce((sum, r) => sum + r.saved, 0);

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    totalIndicators: results.length,
    totalRowsSaved: totalSaved,
    results,
  });
}
