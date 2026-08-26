import { NextResponse } from "next/server";
import { supabase } from "@/config/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error, status, statusText } = await supabase
      .from("economic_data_points")
      .select("*")
      .eq("indicator", "CPI")
      .order("release_date", { ascending: false })
      .limit(5);

    return NextResponse.json({
      envCheck: {
        hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        urlPreview: process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30),
      },
      status,
      statusText,
      error: error ? { message: error.message, code: error.code } : null,
      rowCount: data?.length ?? 0,
      rows: data,
    });
  } catch (err) {
    return NextResponse.json(
      {
        caughtError: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
