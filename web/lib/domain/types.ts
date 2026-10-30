// Core domain types shared by the counter screen, the data stores and printing.
// All money is integer paise (₹1 = 100 paise) to avoid rounding errors.

export type Paise = number;

export type Role = "owner" | "cashier";
export type Channel = "counter" | "swiggy" | "zomato" | "phone";
export type PaymentMethod = "cash" | "upi";
/** Counter orders: eaten here or taken away. */
export type Service = "dine_in" | "takeaway";

export interface Category {
  id: string;
  name: string;
  sort: number;
}

export interface Item {
  id: string;
  categoryId: string;
  name: string;
  /** Batch-cooked items (momos) appear in leftovers and prep forecasts. */
  batchCooked: boolean;
  modifierIds: string[];
  sort: number;
}

export interface Variant {
  id: string;
  itemId: string;
  /** e.g. "Steamed · Full" */
  name: string;
  pricePaise: Paise;
  /** Null when the owner has not entered a cost yet. */
  costPaise: Paise | null;
  active: boolean;
  sort: number;
}

export interface Modifier {
  id: string;
  name: string;
  pricePaise: Paise;
  costPaise: Paise | null;
}

export interface Combo {
  id: string;
  name: string;
  /** Short description of what is inside, e.g. "Veg Stm Full + drink 250". */
  description: string;
  pricePaise: Paise;
  costPaise: Paise | null;
  parts: { variantId: string; qty: number }[];
  active: boolean;
}

export interface Menu {
  version: number;
  categories: Category[];
  items: Item[];
  variants: Variant[];
  modifiers: Modifier[];
  combos: Combo[];
  /** Sellable ids (variant or combo) shown on the Favourites tab, in order. */
  favourites: string[];
}

export interface Staff {
  id: string;
  name: string;
  role: Role;
}

export interface Outlet {
  id: string;
  name: string;
  addressLine: string;
  phone: string;
  fssaiNo: string;
  receiptFooter: string;
  isDemo: boolean;
  /** Cashiers can discount up to this amount without the owner's PIN. */
  cashierDiscountLimitPaise: Paise;
}

export interface Device {
  id: string;
  code: string; // "T1"
}

export interface LineModifier {
  modifierId: string;
  name: string;
  pricePaise: Paise;
  costPaise: Paise | null;
}

export interface OrderLine {
  /** Client-side key, stable while editing the cart. */
  key: string;
  kind: "variant" | "combo";
  refId: string;
  /** Name as printed, e.g. "Veg Momos Steamed Full". Snapshot at time of sale. */
  name: string;
  qty: number;
  unitPricePaise: Paise;
  unitCostPaise: Paise | null;
  modifiers: LineModifier[];
}

export interface Discount {
  amountPaise: Paise;
  reason: string;
  approvedBy: string | null;
  /** Single-use owner approval from the backend, for discounts above the cashier limit. */
  approvalToken?: string | null;
}

export interface Payment {
  method: PaymentMethod;
  amountPaise: Paise;
  /** Only for cash: what the customer handed over. */
  cashReceivedPaise: Paise | null;
}

export interface Order {
  /** Client-generated UUID. Retrying a submit with the same id never duplicates. */
  id: string;
  billNo: string;
  token: number;
  deviceCode: string;
  staffId: string;
  staffName: string;
  daySessionId: string;
  channel: Channel;
  /** Dine in / takeaway. Null on bills from before this was asked, and on delivery orders. */
  service?: Service | null;
  externalOrderId: string | null;
  note: string | null;
  lines: OrderLine[];
  subtotalPaise: Paise;
  discount: Discount | null;
  totalPaise: Paise;
  payments: Payment[];
  /** Dine-in bill saved before the customer paid ("Not paid"); payments are added when settled. */
  unpaid?: boolean;
  createdAt: string; // ISO
  menuVersion: number;
  voided: { reason: string; by: string; approvedBy: string | null; at: string } | null;
}

export type ExpenseCategory =
  | "ingredients"
  | "packaging"
  | "gas"
  | "rent"
  | "salary"
  | "electricity"
  | "maintenance"
  | "other";

export interface Expense {
  id: string;
  category: ExpenseCategory;
  amountPaise: Paise;
  method: PaymentMethod;
  note: string | null;
  staffId: string;
  staffName: string;
  daySessionId: string;
  createdAt: string;
}

export interface CashMovement {
  id: string;
  direction: "in" | "out";
  amountPaise: Paise;
  reason: string;
  staffId: string;
  staffName: string;
  daySessionId: string;
  createdAt: string;
}

export interface DaySession {
  id: string;
  businessDate: string; // YYYY-MM-DD
  openedAt: string;
  openedBy: string;
  openingFloatPaise: Paise;
  closedAt: string | null;
  closedBy: string | null;
  expectedCashPaise: Paise | null;
  countedCashPaise: Paise | null;
  variancePaise: Paise | null;
  leftovers: { variantId: string; plates: number }[];
}

export interface DayTotals {
  orders: number;
  salesPaise: Paise;
  cashSalesPaise: Paise;
  upiSalesPaise: Paise;
  voids: number;
  voidedPaise: Paise;
  discountsPaise: Paise;
  expenseCashPaise: Paise;
  expenseUpiPaise: Paise;
  cashInPaise: Paise;
  cashOutPaise: Paise;
  /** Dine-in bills not paid yet (not voided). */
  unpaidCount: number;
  unpaidPaise: Paise;
  /** Opening float + cash sales + cash in − cash expenses − cash out. */
  expectedCashPaise: Paise;
}
