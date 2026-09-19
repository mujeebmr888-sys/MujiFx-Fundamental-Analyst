/**
 * Syncs EVERY indicator we have a FRED mapping for, THEN generates MUJIFX's
 * own forecasts for the major releases. Combined into one route so a single
 * daily cron job (Vercel's Hobby plan is limited on cron jobs) covers both
 * steps. See vercel.json for the schedule.
 *
 * Protected: only Vercel's own cron scheduler (or someone who knows the
 * CRON_SECRET) can trigger this - otherwise anyone on the internet could
 * spam our FRED quota by hitting this URL repeatedly.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron-auth";
import {
  fetchLatestFromFred,
  ALL_FRED_INDICATORS,
} from "@/layers/data-acquisition/sources/fred";
import { normalizeToRow } from "@/layers/data-normalization/normalize";
import { generateForecast } from "@/layers/forecast-engine/forecast";
import { generateAnalystAssessment } from "@/layers/ai-analyst-reasoning/analyst";
import { buildUsdAssessment } from "@/layers/assessment-pipeline/build-usd-assessment";
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
  // Fail-closed: refuses if CRON_SECRET is unset rather than letting the
  // internet trigger a full sync. Vercel Cron sends the header for us.
  const denied = requireCronSecret(request);
  if (denied) return denied;

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

  // Layer 6 + 7: run the real assessment engine (six category engines +
  // orchestrator), then have the AI analyst write it up. Runs after every
  // sync so the note always reflects the freshest stored data.
  //
  // FIXED: this previously ran the legacy quick score and fed THAT to the
  // analyst, so the written note described a number the engine does not
  // treat as authoritative and never saw any category evidence.
  let analystStatus = "skipped";
  let overallCondition: string | null = null;

  try {
    const { assessment: usdAssessment, readErrors } = await buildUsdAssessment();
    overallCondition = usdAssessment.overallCondition;

    if (readErrors.length > 0) {
      console.warn("Assessment ran with unreadable histories:", readErrors);
    }

    const allIndicators = Object.keys(INDICATOR_META) as IndicatorId[];
    const latestByIndicator = await getLatestForIndicators(allIndicators);

    const indicatorFacts = [];
    for (const [id, row] of latestByIndicator.entries()) {
      indicatorFacts.push({
        label: INDICATOR_META[id as IndicatorId]?.label ?? id,
        actual: row.actual,
        previous: row.previous,
        periodCovered: row.period_covered,
        source: {
          name: row.source_name,
          url: row.source_url,
          tier: row.source_tier,
          retrievedAt: row.retrieved_at,
        },
      });
    }

    const note = await generateAnalystAssessment({
      assessment: usdAssessment,
      indicatorFacts,
    });

    if (note) {
      await saveAnalystAssessment(note, {
        overallCondition: usdAssessment.overallCondition,
        overallConfidence: usdAssessment.confidence,
        decisionRule: usdAssessment.rationale,
      });
      analystStatus = "success";
    } else {
      // Null is the expected, honest outcome when GEMINI_API_KEY is unset
      // or the model's output failed validation. The data pipeline above
      // has already succeeded either way.
      analystStatus = process.env.GEMINI_API_KEY
        ? "failed validation (nothing saved - see logs)"
        : "skipped (GEMINI_API_KEY not set)";
    }
  } catch (err) {
    console.error("Assessment/analyst step failed:", err);
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
    overallCondition,
    analyst: analystStatus,
  });
}
