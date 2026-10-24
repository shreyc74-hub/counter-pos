import type { CashMovement, DaySession, Expense, Order, Staff } from "@/lib/domain/types";
import type { Bootstrap } from "./store";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

const UNSAVED_KEY = "cpos.unsaved.v1";
const SNAPSHOT_KEY = "cpos.snapshot.v1";

/** A bill that was printed while the database couldn't be reached, waiting to be saved. */
export interface UnsavedBill {
  order: Order;
  /** Set when the database answered but refused the bill (it will not succeed by retrying). */
  refused: string | null;
}

/**
 * Bills kept on this phone until the database confirms them. Orders carry their own
 * id, so sending one again is always safe: the database keeps the first copy.
 */
export class UnsavedBills {
  constructor(private readonly storage: Storage | null = safeLocalStorage()) {}

  list(): UnsavedBill[] {
    try {
      const v = JSON.parse(this.storage?.getItem(UNSAVED_KEY) ?? "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  add(order: Order): UnsavedBill[] {
    const next = [...this.list().filter((b) => b.order.id !== order.id), { order, refused: null }];
    this.write(next);
    return next;
  }

  remove(orderId: string): UnsavedBill[] {
    const next = this.list().filter((b) => b.order.id !== orderId);
    this.write(next);
    return next;
  }

  markRefused(orderId: string, reason: string): UnsavedBill[] {
    const next = this.list().map((b) => (b.order.id === orderId ? { ...b, refused: reason } : b));
    this.write(next);
    return next;
  }

  private write(list: UnsavedBill[]): void {
    // If this fails the bill would only exist on paper, so let the caller see the error.
    this.storage?.setItem(UNSAVED_KEY, JSON.stringify(list));
  }
}

/** What the counter last showed, so it can keep billing after a reload while the database is down. */
export interface Snapshot {
  savedAt: string;
  boot: Bootstrap;
  staff: Staff;
  day: DaySession;
  orders: Order[];
  expenses: Expense[];
  movements: CashMovement[];
}

export function saveSnapshot(s: Omit<Snapshot, "savedAt">, storage: Storage | null = safeLocalStorage()): void {
  try {
    storage?.setItem(SNAPSHOT_KEY, JSON.stringify({ ...s, savedAt: new Date().toISOString() }));
  } catch {
    // Storage full or blocked: the snapshot is a convenience, billing carries on.
  }
}

export function loadSnapshot(storage: Storage | null = safeLocalStorage()): Snapshot | null {
  try {
    const s = JSON.parse(storage?.getItem(SNAPSHOT_KEY) ?? "null") as Snapshot | null;
    return s?.boot && s.day && s.staff ? s : null;
  } catch {
    return null;
  }
}

export function clearSnapshot(storage: Storage | null = safeLocalStorage()): void {
  try {
    storage?.removeItem(SNAPSHOT_KEY);
  } catch {
    // ignore
  }
}

/** Server orders plus this phone's unsaved bills for the same day (newest first). */
export function mergeUnsaved(orders: Order[], unsaved: UnsavedBill[], dayId: string): Order[] {
  const known = new Set(orders.map((o) => o.id));
  const extra = unsaved.map((b) => b.order).filter((o) => o.daySessionId === dayId && !known.has(o.id));
  return [...extra, ...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
