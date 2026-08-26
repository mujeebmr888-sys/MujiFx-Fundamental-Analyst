/**
 * ADMIN Supabase client — uses the secret service_role key.
 *
 * SERVER-SIDE ONLY. This file must never be imported into any component
 * that runs in the browser. It bypasses Row Level Security, so it's the
 * only thing allowed to write to economic_data_points.
 *
 * The regular client in supabase.ts (using the publishable key) is used
 * for all reads, including reads from browser-rendered pages.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.warn(
    "Supabase admin env vars are missing. Set SUPABASE_SERVICE_ROLE_KEY in .env.local / Vercel (as a Secret, never NEXT_PUBLIC_)."
  );
}

export const supabaseAdmin = createClient(
  supabaseUrl ?? "",
  serviceRoleKey ?? ""
);
