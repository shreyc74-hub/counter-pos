import type { ItemPhoto, PosStore } from "./store";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
type Cache = Record<string, { updatedAt: string; data: string }>;

const KEY = "cpos.photos.v1";

/**
 * Dish photos for the counter tiles, by item id. Photos are kept on the device and only
 * new or changed ones are downloaded, so opening the app stays quick on mobile data.
 */
export async function loadPhotos(store: PosStore, storage: Storage | null = safeLocalStorage()): Promise<Record<string, string>> {
  if (!store.itemPhotos) return {};
  const cache = readCache(storage);
  const have = Object.fromEntries(Object.entries(cache).map(([id, p]) => [id, p.updatedAt]));
  const rows = await store.itemPhotos(have);
  const next = mergePhotos(cache, rows);
  try {
    storage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full: photos still show now, they are just downloaded again next time.
  }
  return Object.fromEntries(Object.entries(next).map(([id, p]) => [id, p.data]));
}

/** The server's list is the truth: photos it no longer lists are dropped. */
export function mergePhotos(cache: Cache, rows: ItemPhoto[]): Cache {
  const next: Cache = {};
  for (const r of rows) {
    const data = r.data ?? cache[r.itemId]?.data;
    if (data) next[r.itemId] = { updatedAt: r.updatedAt, data };
  }
  return next;
}

function readCache(storage: Storage | null): Cache {
  try {
    const v = JSON.parse(storage?.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
