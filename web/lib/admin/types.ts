import type { Combo, Outlet, Paise } from "@/lib/domain/types";

// ---------------------------------------------------------------- menu as the owner sees it (with costs)

export interface AdminCategory {
  id: string;
  name: string;
  sort: number;
  active: boolean;
}

export interface AdminItem {
  id: string;
  categoryId: string;
  name: string;
  batchCooked: boolean;
  sort: number;
  active: boolean;
  modifierIds: string[];
}

export interface AdminVariant {
  id: string;
  itemId: string;
  name: string;
  sort: number;
  active: boolean;
  pricePaise: Paise | null;
  costPaise: Paise | null;
  priceSince?: string | null;
}

export interface AdminModifier {
  id: string;
  name: string;
  active: boolean;
  pricePaise: Paise;
  costPaise: Paise | null;
}

export type AdminCombo = Omit<Combo, "pricePaise"> & { pricePaise: Paise | null };

export interface AdminMenu {
  version: number;
  categories: AdminCategory[];
  items: AdminItem[];
  variants: AdminVariant[];
  modifiers: AdminModifier[];
  combos: AdminCombo[];
  favourites: string[];
}

export interface PricePoint {
  pricePaise: Paise;
  costPaise: Paise | null;
  from: string;
}

// ---------------------------------------------------------------- dashboard facts

export interface LineFact {
  refId: string;
  kind: "variant" | "combo";
  qty: number;
  total: Paise;
  /** Cost of the whole line at the time of sale; null if no cost was entered. */
  cost: Paise | null;
}

export interface OrderFact {
  id: string;
  /** Epoch milliseconds. */
  at: number;
  dayId: string;
  staff: string;
  channel: "counter" | "swiggy" | "zomato" | "phone";
  subtotal: Paise;
  discount: Paise;
  total: Paise;
  cash: Paise;
  upi: Paise;
  voided: boolean;
  voidedBy: string | null;
  lines: LineFact[];
}

export interface DayFact {
  id: string;
  date: string; // YYYY-MM-DD
  openedAt: string;
  closedAt: string | null;
  openingFloatPaise: Paise;
  expectedCashPaise: Paise | null;
  countedCashPaise: Paise | null;
  variancePaise: Paise | null;
  closedBy: string | null;
  leftovers: [string, number][];
}

export interface ExpenseFact {
  dayId: string;
  category: string;
  amount: Paise;
  method: "cash" | "upi";
  at: number;
}

export interface MovementFact {
  dayId: string;
  direction: "in" | "out";
  amount: Paise;
}

export interface StockOutFact {
  refId: string;
  at: number;
}

export interface Facts {
  days: DayFact[];
  orders: OrderFact[];
  expenses: ExpenseFact[];
  movements: MovementFact[];
  stockOuts: StockOutFact[];
}

export interface AdminStore {
  readonly kind: "demo" | "supabase";
  /** Signed-in owner's email, or null. */
  currentUser(): Promise<string | null>;
  /** Supabase: emails a 6-digit code. Demo: no-op. */
  startSignIn(email: string): Promise<void>;
  /** Supabase: email + code. Demo: email is ignored, code is the owner PIN. */
  verifySignIn(email: string, code: string): Promise<boolean>;
  signOut(): Promise<void>;
  /** Supabase only: the outlet's devices by name (owner devices can open the admin panel). */
  deviceChoices?(): Promise<{ code: string; name: string; outlet: string }[]>;
  /** Supabase only: sign in with a device key instead of email. */
  signInWithDevice?(key: string): Promise<boolean>;
  outlets(): Promise<Outlet[]>;

  menu(outletId: string): Promise<AdminMenu>;
  priceHistory(outletId: string, refId: string): Promise<PricePoint[]>;
  saveCategory(outletId: string, c: Omit<AdminCategory, "id"> & { id: string | null }): Promise<string>;
  saveItem(outletId: string, i: Omit<AdminItem, "id"> & { id: string | null }): Promise<string>;
  saveVariant(outletId: string, v: Omit<AdminVariant, "id" | "priceSince"> & { id: string | null }): Promise<string>;
  saveModifier(outletId: string, m: Omit<AdminModifier, "id"> & { id: string | null }): Promise<string>;
  saveCombo(outletId: string, c: Omit<AdminCombo, "id"> & { id: string | null }): Promise<string>;
  setFavourites(outletId: string, ids: string[]): Promise<void>;

  /** Everything the dashboard needs for a business-date range (inclusive). */
  facts(outletId: string, from: string, to: string): Promise<Facts>;
}
