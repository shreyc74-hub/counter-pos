/**
 * Supabase settings, read when the app is built. Vercel's Supabase integration and the
 * Supabase dashboard use different names for the public key, so accept all of them.
 * (Each name must be written out in full: Next.js only bakes in literal NEXT_PUBLIC_* reads.)
 */
export interface SupabaseConfig {
  url: string | null;
  key: string | null;
  /** Human-readable reason when the app falls back to demo mode. */
  missing: string[];
}

export function supabaseConfig(): SupabaseConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || null;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY ||
    null;
  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!key) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { url: url ? url.replace(/\/$/, "") : null, key, missing };
}
