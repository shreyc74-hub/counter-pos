import { DemoAdminStore } from "./demoAdminStore";
import { SupabaseAdminStore } from "./supabaseAdminStore";
import type { AdminStore } from "./types";

/** Same switch as the counter: Supabase when configured, otherwise demo data in the browser. */
export function createAdminStore(): AdminStore {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) return new SupabaseAdminStore(url.replace(/\/$/, ""), key);
  return new DemoAdminStore();
}
