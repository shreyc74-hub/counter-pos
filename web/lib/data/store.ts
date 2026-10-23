import type {
  CashMovement,
  DaySession,
  Device,
  Expense,
  Menu,
  Order,
  Outlet,
  Paise,
  Staff,
} from "@/lib/domain/types";

export interface Bootstrap {
  outlet: Outlet;
  device: Device;
  menu: Menu;
  /** Sellable ids currently marked sold out. */
  soldOut: string[];
}

export interface CloseDayInput {
  countedCashPaise: Paise;
  leftovers: { variantId: string; plates: number }[];
}

/**
 * Everything the counter screen needs from a backend. Two implementations:
 * - DemoStore: in the browser (localStorage), for trying the app with no backend.
 * - SupabaseStore: the real backend (business rules live in Postgres functions).
 */
export interface PosStore {
  readonly kind: "demo" | "supabase";
  load(): Promise<Bootstrap>;
  /** Returns the staff member for a PIN, or null. */
  login(pin: string): Promise<Staff | null>;
  /** Checks an owner PIN for approvals (voids, big discounts). */
  verifyOwnerPin(pin: string): Promise<Staff | null>;
  logout(): Promise<void>;

  currentDay(): Promise<DaySession | null>;
  openDay(openingFloatPaise: Paise): Promise<DaySession>;
  closeDay(input: CloseDayInput): Promise<DaySession>;

  /** Bill number and token for the next order. Generated on the device. */
  nextBillNumber(): Promise<{ billNo: string; token: number }>;
  submitOrder(order: Order): Promise<void>;
  listOrders(daySessionId: string): Promise<Order[]>;
  voidOrder(orderId: string, reason: string, approverPin: string | null): Promise<void>;

  addExpense(e: Omit<Expense, "id" | "createdAt" | "staffId" | "staffName" | "daySessionId">): Promise<Expense>;
  listExpenses(daySessionId: string): Promise<Expense[]>;
  addCashMovement(
    m: Omit<CashMovement, "id" | "createdAt" | "staffId" | "staffName" | "daySessionId">,
  ): Promise<CashMovement>;
  listCashMovements(daySessionId: string): Promise<CashMovement[]>;

  setSoldOut(sellableId: string, soldOut: boolean): Promise<void>;
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly code: "no_session" | "no_open_day" | "not_allowed" | "invalid" | "network" | "conflict",
  ) {
    super(message);
  }
}
