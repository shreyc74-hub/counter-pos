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

/**
 * Accepts the Project URL (https://<ref>.supabase.co), tolerating a trailing slash or
 * /rest/v1, or a dashboard link (https://supabase.com/dashboard/project/<ref>) which is
 * turned into the Project URL. Anything else (e.g. a postgres:// connection string) is rejected.
 */
export function normalizeSupabaseUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (!v) return null;
  const dash = v.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dash) return `https://${dash[1]}.supabase.co`;
  const withScheme = /^[a-z0-9-]+\.supabase\.(co|in)/i.test(v) ? `https://${v}` : v;
  if (!/^https?:\/\//i.test(withScheme)) return null;
  return withScheme.replace(/\/+$/, "").replace(/\/rest\/v1$/i, "").replace(/\/+$/, "");
}

export function supabaseConfig(): SupabaseConfig {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || null;
  const url = normalizeSupabaseUrl(rawUrl);
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim().replace(/^["']|["']$/g, "") || null;
  const missing: string[] = [];
  if (!rawUrl) missing.push("the Supabase URL (NEXT_PUBLIC_SUPABASE_URL)");
  else if (!url) missing.push("a valid Supabase Project URL (the URL setting isn't an https://….supabase.co address)");
  if (!key) missing.push("the Supabase anon / publishable key (NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  return {
    url,
    key,
    missing,
    seenNames: process.env.NEXT_PUBLIC_SUPABASE_SEEN_NAMES || "",
  };
}
