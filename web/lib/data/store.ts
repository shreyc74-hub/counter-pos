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

export interface DeviceChoice {
  code: string;
  name: string;
  outlet: string;
}

export interface Bootstrap {
  outlet: Outlet;
  device: Device;
  menu: Menu;
  /** Sellable ids currently marked sold out. */
  soldOut: string[];
  /** The device signs straight in as its linked staff member (no PIN screen). */
  autoLogin?: boolean;
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
  /** Supabase only: the key that registers this tablet as a counter device. */
  setDeviceKey?(key: string): void;
  /** Supabase only: the outlet's devices by name, for the set-up screen. */
  deviceChoices?(): Promise<DeviceChoice[]>;
  /** Supabase only: sign in with just the device key (devices linked to a person). */
  autoLogin?(): Promise<Staff | null>;
  load(): Promise<Bootstrap>;
  /** Supabase only: cheap check that the database is reachable. */
  ping?(): Promise<void>;
  /** Supabase only: carry on from a snapshot saved on this phone while the database is unreachable. */
  resumeOffline?(boot: Bootstrap, day: DaySession | null): void;
  /** Returns the staff member for a PIN, or null. */
  login(pin: string): Promise<Staff | null>;
  /** Owner approval for a big discount. Null if the PIN is not an owner's. */
  approveAsOwner(pin: string): Promise<OwnerApproval | null>;
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

export interface OwnerApproval {
  name: string;
  approvalToken: string;
}

export type StoreErrorCode =
  | "no_device"
  | "no_session"
  | "no_open_day"
  | "not_allowed"
  | "invalid"
  | "network"
  | "conflict"
  | "locked";

export class StoreError extends Error {
  constructor(
    message: string,
    readonly code: StoreErrorCode,
  ) {
    super(message);
  }
}
