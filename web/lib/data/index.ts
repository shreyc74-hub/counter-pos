import { supabaseConfig } from "@/lib/supabaseConfig";
import { DemoStore } from "./demoStore";
import type { PosStore } from "./store";
import { SupabaseStore } from "./supabaseStore";

/** Picks the backend: Supabase when its settings were present at build time, otherwise the in-browser demo store. */
export function createStore(): PosStore {
  const { url, key } = supabaseConfig();
  if (url && key) return new SupabaseStore(url, key);
  return new DemoStore();
}
