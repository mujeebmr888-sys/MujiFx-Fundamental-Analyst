/**
 * Syncs EVERY indicator we have a FRED mapping for, THEN generates MUJIFX's
 * own forecasts for the major releases. Combined into one route so a single
 * daily cron job (Vercel's Hobby plan is limited on cron jobs) covers both
 * steps. See vercel.json for the schedule.
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
import { generateForecast } from "@/layers/forecast-engine/forecast";
import { computeUsdFundamentalScore } from "@/layers/fundamental-scoring/scoring";
import { generateAnalystAssessment } from "@/layers/ai-analyst-reasoning/analyst";
import {
  saveDataPoint,
  getIndicatorHistory,
  saveForecast,
  getLatestForIndicators,
  saveAnalystAssessment,
} from "@/layers/historical-database/database";
import { INDICATOR_META } from "@/config/indicators";
import type { IndicatorId } from "@/types/economic-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby plan's hard cap

const MAJOR_RELEASES_TO_FORECAST: IndicatorId[] = ["CPI", "PPI", "NFP", "GDP"];

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

  const forecastResults: Array<{ indicator: string; success: boolean }> = [];
  for (const indicator of MAJOR_RELEASES_TO_FORECAST) {
    try {
      const history = await getIndicatorHistory(indicator, 12);
      const forecast = generateForecast(indicator, history ?? []);
      await saveForecast(forecast);
      forecastResults.push({ indicator, success: true });
    } catch (err) {
      console.error(`Forecast generation failed for ${indicator}:`, err);
      forecastResults.push({ indicator, success: false });
    }
  }

  const successCount = results.filter((r) => r.success).length;

  // Layer 6 + 7: compute the fundamental score, then have the AI analyst
  // write it up. Runs after every sync so the commentary always reflects
  // the freshest data.
  let analystStatus = "skipped";
  try {
    const allIndicators = Object.keys(INDICATOR_META) as IndicatorId[];
    const latestByIndicator = await getLatestForIndicators(allIndicators);

    const momChangeByIndicator = new Map<IndicatorId, number | null>();
    const indicatorSummaries = [];
    for (const [id, row] of latestByIndicator.entries()) {
      const momChange =
        row.actual != null && row.previous != null
          ? Math.round((row.actual - row.previous) * 1000) / 1000
          : null;
      momChangeByIndicator.set(id as IndicatorId, momChange);
      indicatorSummaries.push({
        indicator: id,
        actual: row.actual,
        previous: row.previous,
        momChange,
        periodCovered: row.period_covered,
        sourceUrl: row.source_url,
      });
    }

    const fundamentalScore = computeUsdFundamentalScore(momChangeByIndicator);
    const assessment = await generateAnalystAssessment({
      fundamentalScore,
      indicatorSummaries,
    });

    if (assessment) {
      await saveAnalystAssessment(
        assessment,
        fundamentalScore.score,
        fundamentalScore.overallBias
      );
      analystStatus = "success";
    } else {
      analystStatus = "failed (see logs)";
    }
  } catch (err) {
    console.error("Analyst assessment step failed:", err);
    analystStatus = "failed (see logs)";
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    sync: {
      total: results.length,
      succeeded: successCount,
      failed: results.length - successCount,
      results,
    },
    forecasts: forecastResults,
    analyst: analystStatus,
  });
}
