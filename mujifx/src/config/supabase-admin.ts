/**
 * ADMIN Supabase client - uses the secret service_role key.
 *
 * SERVER-SIDE ONLY. This file must never be imported into any component
 * that runs in the browser. It bypasses Row Level Security, so it's the
 * only thing allowed to write to economic_data_points.
 *
 * Lazily constructed for the same reason as the read client - see the note
 * in supabase.ts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (cached) return cached;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Supabase admin env vars are missing. Set SUPABASE_SERVICE_ROLE_KEY in .env.local / Vercel (as a Secret, never NEXT_PUBLIC_)."
    );
  }

  cached = createClient(supabaseUrl, serviceRoleKey);
  return cached;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getAdminClient(), prop, receiver);
  },
});
