/**
 * SHARED JOB AUTHORIZATION
 *
 * Every route under /api/sync/* performs writes and/or burns a rate-limited
 * upstream API quota (FRED, BLS, BEA, Census, DOL). Before this helper
 * existed, only 5 of 13 sync routes checked CRON_SECRET — the other 8 were
 * openly callable by anyone on the internet, who could have hammered them
 * to exhaust the upstream quotas and continuously rewrite rows.
 *
 * Usage at the top of every sync route:
 *
 *   const denied = requireCronSecret(request);
 *   if (denied) return denied;
 *
 * Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET`.
 *
 * FAIL-CLOSED: if CRON_SECRET is not configured at all, the route refuses
 * (503) rather than silently allowing everyone in. The previous pattern
 * (`if (process.env.CRON_SECRET && !authorized) reject`) meant forgetting to
 * set the variable in production left the route wide open — exactly the
 * failure mode a guard is supposed to prevent. Set ALLOW_UNPROTECTED_SYNC=1
 * in .env.local if you want to poke these routes from a browser in local dev.
 */
import { NextResponse, type NextRequest } from "next/server";

export function requireCronSecret(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    if (process.env.ALLOW_UNPROTECTED_SYNC === "1") return null;
    return NextResponse.json(
      {
        success: false,
        error:
          "CRON_SECRET is not configured. This route writes to the database and is refused until it is set. See .env.example.",
      },
      { status: 503 }
    );
  }

  const header = request.headers.get("authorization")?.trim();
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
