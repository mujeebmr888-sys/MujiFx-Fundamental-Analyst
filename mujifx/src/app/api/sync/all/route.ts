/**
 * Syncs EVERY indicator we have a FRED mapping for. This is the route the
 * daily cron job hits (see vercel.json). It's also safe to call manually.
 *
 * Protected: only Vercel's own cron scheduler (or someone who knows the
 * CRON_SECRET) can trigger this — otherwise anyone on the internet could
 * spam our FRED quota by hitting this URL repeatedly.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  fetchLatestFromFred,
  ALL_FRED_INDICATORS,
} from "@/layers/data-acquisition/sources/fred";
import { normalizeToRow } from "@/layers/data-normalization/normalize";
import { saveDataPoint } from "@/layers/historical-database/database";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // this route calls FRED ~17 times; give it room

export async function GET(request: NextRequest) {
  // Vercel automatically sends this header on cron-triggered requests.
  const authHeader = request.headers.get("authorization");
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  // Allow manual browser testing too (no secret configured yet, or running
  // locally) — but once CRON_SECRET is set in production, only the cron
  // job (or someone who knows the secret) can trigger this.
  if (process.env.CRON_SECRET && !isVercelCron) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{
    indicator: string;
    success: boolean;
    detail?: string;
  }> = [];

  for (const indicator of ALL_FRED_INDICATORS) {
    try {
      const point = await fetchLatestFromFred(indicator);

      if (!point.available) {
        results.push({
          indicator,
          success: false,
          detail: point.unavailableReason,
        });
        continue;
      }

      const row = normalizeToRow(point);
      await saveDataPoint(row);
      results.push({ indicator, success: true });
    } catch (err) {
      console.error(`Sync failed for ${indicator}:`, err);
      results.push({
        indicator,
        success: false,
        detail: "See server logs for details.",
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    total: results.length,
    succeeded: successCount,
    failed: results.length - successCount,
    results,
  });
}
