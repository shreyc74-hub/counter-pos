/**
 * Supabase settings, baked in when the app is built. next.config.ts maps the various
 * names the settings can arrive under (by hand, Vercel's integration, prefixed) onto
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */
export interface SupabaseConfig {
  url: string | null;
  key: string | null;
  /** Human-readable reason when the app falls back to demo mode. */
  missing: string[];
  /** Supabase-related variable names the build could see (names only), to help setup. */
  seenNames: string;
}

export function supabaseConfig(): SupabaseConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || null;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null;
  const missing: string[] = [];
  if (!url) missing.push("the Supabase URL (NEXT_PUBLIC_SUPABASE_URL)");
  if (!key) missing.push("the Supabase anon / publishable key (NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  return {
    url: url ? url.replace(/\/$/, "") : null,
    key,
    missing,
    seenNames: process.env.NEXT_PUBLIC_SUPABASE_SEEN_NAMES || "",
  };
}
