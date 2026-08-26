/**
 * Manual trigger for the full pipeline, for ONE indicator (CPI), to prove
 * the whole chain works end-to-end:
 *   FRED (layer 1) → normalize (layer 2) → Supabase (layer 3)
 *
 * Visit /api/sync/cpi in the browser (or call it) to run it.
 * Later this will be replaced by a scheduled job, but a manual route is the
 * simplest way to verify each layer actually works before automating it.
 */

import { NextResponse } from "next/server";
import { fetchLatestFromFred } from "@/layers/data-acquisition/sources/fred";
import { normalizeToRow } from "@/layers/data-normalization/normalize";
import { saveDataPoint } from "@/layers/historical-database/database";

export async function GET() {
  const point = await fetchLatestFromFred("CPI");

  if (!point.available) {
    return NextResponse.json(
      {
        success: false,
        stage: "data-acquisition",
        reason: point.unavailableReason,
      },
      { status: 200 }
    );
  }

  try {
    const row = normalizeToRow(point);
    const saved = await saveDataPoint(row);

    return NextResponse.json({
      success: true,
      indicator: "CPI",
      saved,
    });
  } catch (err) {
    // Log the full error server-side only (visible in Vercel's function logs,
    // never in the response the browser receives) — the response itself
    // must never echo raw error text, since it could contain sensitive
    // details like a malformed API key.
    console.error("CPI sync failed:", err);

    return NextResponse.json(
      {
        success: false,
        stage: "database",
        reason:
          "Could not save data. Check the Vercel function logs for details.",
      },
      { status: 500 }
    );
  }
}
