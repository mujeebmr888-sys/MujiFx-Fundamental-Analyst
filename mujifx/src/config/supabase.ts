/**
 * Single READ Supabase client used across the app.
 * Reads config from environment variables - never hardcode keys here.
 *
 * LAZY ON PURPOSE: createClient() throws "supabaseUrl is required" the
 * moment it is called with an empty URL. Constructing it at module scope
 * meant `next build` crashed while collecting page data whenever the env
 * vars weren't present (CI, a fresh clone, a preview deploy missing a var).
 * The proxy below defers construction until a query actually runs, so a
 * missing variable produces one clear error at request time instead of
 * failing the whole build.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (cached) return cached;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see .env.example)."
    );
  }

  cached = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      fetch: (url, options = {}) => fetch(url, { ...options, cache: "no-store" }),
    },
  });
  return cached;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});
