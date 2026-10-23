import { DemoStore } from "./demoStore";
import type { PosStore } from "./store";

/** Picks the backend. Without Supabase settings the app runs on the in-browser demo store. */
export function createStore(): PosStore {
  return new DemoStore();
}
