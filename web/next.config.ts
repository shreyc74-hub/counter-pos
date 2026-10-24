import type { NextConfig } from "next";

// Supabase settings can arrive under different names depending on how they were added
// (by hand, Vercel's Supabase integration, with or without a prefix). Pick the first one
// present at build time and expose it to the browser under one name. Only the project URL
// and the PUBLIC (anon / publishable) key are ever used here, never the service-role key.
const first = (...names: string[]) => names.map((n) => process.env[n]).find((v) => v && v.trim())?.trim() ?? "";

const supabaseUrl = first(
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "STORAGE_NEXT_PUBLIC_SUPABASE_URL",
  "STORAGE_SUPABASE_URL",
);
const supabaseKey = first(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "STORAGE_NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "STORAGE_SUPABASE_ANON_KEY",
);

// Names that exist at build time (names only, never values), shown on the demo screen to help setup.
const seen = Object.keys(process.env).filter((n) => /SUPABASE/i.test(n) && !/SERVICE|SECRET|JWT|PASSWORD/i.test(n));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseKey,
    NEXT_PUBLIC_SUPABASE_SEEN_NAMES: seen.sort().join(", "),
  },
};

export default nextConfig;
