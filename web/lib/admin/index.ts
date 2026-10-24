import { supabaseConfig } from "@/lib/supabaseConfig";
import { DemoAdminStore } from "./demoAdminStore";
import { SupabaseAdminStore } from "./supabaseAdminStore";
import type { AdminStore } from "./types";

/** Same switch as the counter: Supabase when configured, otherwise demo data in the browser. */
export function createAdminStore(): AdminStore {
  const { url, key } = supabaseConfig();
  if (url && key) return new SupabaseAdminStore(url, key);
  return new DemoAdminStore();
}
