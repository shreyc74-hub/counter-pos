import { DemoStore } from "./demoStore";
import type { PosStore } from "./store";
import { SupabaseStore } from "./supabaseStore";

/**
 * Picks the backend. With NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY set,
 * the counter uses Supabase; otherwise it runs on the in-browser demo store.
 */
export function createStore(): PosStore {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) return new SupabaseStore(url.replace(/\/$/, ""), key);
  return new DemoStore();
}
