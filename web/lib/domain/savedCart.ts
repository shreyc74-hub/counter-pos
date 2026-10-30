import { findSellable, newLine, subtotalPaise } from "./cart";
import type { Channel, Discount, Menu, OrderLine, Service } from "./types";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "cpos.cart.v1";

/** The order being built, kept on the device so a page refresh doesn't lose it. */
export interface SavedCart {
  lines: OrderLine[];
  discount: Discount | null;
  channel: Channel;
  service: Service | null;
  externalId: string;
  note: string | null;
}

export function saveCart(c: SavedCart, storage: Storage | null = safeLocalStorage()): void {
  try {
    if (!c.lines.length && !c.note && !c.discount) storage?.removeItem(KEY);
    else storage?.setItem(KEY, JSON.stringify(c));
  } catch {
    // storage full or blocked: the cart just isn't kept across a refresh
  }
}

export function clearSavedCart(storage: Storage | null = safeLocalStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // ignore
  }
}

/**
 * The saved cart, checked against the current menu: items no longer on it are dropped,
 * and names and prices are refreshed so the bill matches what the database expects.
 */
export function loadCart(menu: Menu, storage: Storage | null = safeLocalStorage()): SavedCart | null {
  let saved: SavedCart | null = null;
  try {
    saved = JSON.parse(storage?.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
  if (!saved || !Array.isArray(saved.lines)) return null;
  const lines: OrderLine[] = [];
  for (const l of saved.lines) {
    const s = findSellable(menu, l.refId);
    if (!s || !(l.qty > 0)) continue;
    const mods = (l.modifiers ?? []).map((m) => menu.modifiers.find((x) => x.id === m.modifierId)).filter((m) => !!m);
    lines.push({ ...newLine(s, l.key, mods), qty: l.qty });
  }
  const discount = saved.discount && saved.discount.amountPaise <= subtotalPaise(lines) ? saved.discount : null;
  return {
    lines,
    discount,
    channel: saved.channel ?? "counter",
    service: saved.service ?? null,
    externalId: saved.externalId ?? "",
    note: saved.note ?? null,
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
