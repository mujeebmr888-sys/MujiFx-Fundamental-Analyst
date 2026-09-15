import { NextResponse } from "next/server";
import { POST as runAuthoritativeP0 } from "@/app/api/sync/authoritative-p0/route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, reason: "Unauthorized." },
      { status: 401 }
    );
  }

  // Reuse the protected P0 implementation so the cron path cannot drift
  // from the manual POST endpoint.
  return runAuthoritativeP0(
    new Request(request.url, {
      method: "POST",
      headers: request.headers,
    })
  );
}
