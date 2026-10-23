import { businessDate, computeDayTotals, formatBillNo } from "@/lib/domain/billing";
import type { CashMovement, DaySession, Expense, Order, Paise, Staff } from "@/lib/domain/types";
import { uuid } from "@/lib/uuid";
import { demoMenu, demoOutlet, demoStaff } from "./demoMenu";
import { type Bootstrap, type CloseDayInput, type OwnerApproval, type PosStore, StoreError } from "./store";

interface DemoState {
  days: DaySession[];
  orders: Order[];
  expenses: Expense[];
  movements: CashMovement[];
  soldOut: string[];
  billSeq: number;
  /** Token counter resets every business day. */
  token: { date: string; last: number };
}

const KEY = "cpos.demo.v1";
const DEVICE = { id: "demo-device-t1", code: "T1" };

const empty = (): DemoState => ({
  days: [],
  orders: [],
  expenses: [],
  movements: [],
  soldOut: [],
  billSeq: 0,
  token: { date: "", last: 0 },
});

/** Runs fully in the browser so the counter can be tried with no backend. */
export class DemoStore implements PosStore {
  readonly kind = "demo" as const;
  private staff: Staff | null = null;

  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem"> | null = safeLocalStorage()) {}

  async load(): Promise<Bootstrap> {
    return { outlet: demoOutlet, device: DEVICE, menu: demoMenu, soldOut: this.read().soldOut };
  }

  async login(pin: string): Promise<Staff | null> {
    const s = demoStaff.find((x) => x.pin === pin);
    this.staff = s ? { id: s.id, name: s.name, role: s.role } : null;
    return this.staff;
  }

  async approveAsOwner(pin: string): Promise<OwnerApproval | null> {
    const s = this.owner(pin);
    return s ? { name: s.name, approvalToken: "demo-approval" } : null;
  }

  private owner(pin: string): Staff | null {
    const s = demoStaff.find((x) => x.pin === pin && x.role === "owner");
    return s ? { id: s.id, name: s.name, role: s.role } : null;
  }

  async logout(): Promise<void> {
    this.staff = null;
  }

  async currentDay(): Promise<DaySession | null> {
    return this.read().days.find((d) => d.closedAt === null) ?? null;
  }

  async openDay(openingFloatPaise: Paise): Promise<DaySession> {
    const staff = this.requireStaff();
    const state = this.read();
    if (state.days.some((d) => d.closedAt === null)) throw new StoreError("A day is already open.", "conflict");
    const day: DaySession = {
      id: uuid(),
      businessDate: businessDate(),
      openedAt: new Date().toISOString(),
      openedBy: staff.name,
      openingFloatPaise,
      closedAt: null,
      closedBy: null,
      expectedCashPaise: null,
      countedCashPaise: null,
      variancePaise: null,
      leftovers: [],
    };
    state.days.push(day);
    this.write(state);
    return day;
  }

  async closeDay(input: CloseDayInput): Promise<DaySession> {
    const staff = this.requireStaff();
    const state = this.read();
    const day = state.days.find((d) => d.closedAt === null);
    if (!day) throw new StoreError("No open day.", "no_open_day");
    const totals = computeDayTotals(
      day,
      state.orders.filter((o) => o.daySessionId === day.id),
      state.expenses.filter((e) => e.daySessionId === day.id),
      state.movements.filter((m) => m.daySessionId === day.id),
    );
    day.closedAt = new Date().toISOString();
    day.closedBy = staff.name;
    day.expectedCashPaise = totals.expectedCashPaise;
    day.countedCashPaise = input.countedCashPaise;
    day.variancePaise = input.countedCashPaise - totals.expectedCashPaise;
    day.leftovers = input.leftovers.filter((l) => l.plates > 0);
    this.write(state);
    return day;
  }

  async nextBillNumber(): Promise<{ billNo: string; token: number }> {
    const state = this.read();
    const today = businessDate();
    state.billSeq += 1;
    if (state.token.date !== today) state.token = { date: today, last: 0 };
    state.token.last += 1;
    this.write(state);
    return { billNo: formatBillNo(DEVICE.code, state.billSeq), token: state.token.last };
  }

  async submitOrder(order: Order): Promise<void> {
    this.requireStaff();
    const state = this.read();
    if (state.orders.some((o) => o.id === order.id)) return; // idempotent retry
    if (!state.days.some((d) => d.id === order.daySessionId && d.closedAt === null)) {
      throw new StoreError("The day is not open.", "no_open_day");
    }
    state.orders.push(order);
    this.write(state);
  }

  async listOrders(daySessionId: string): Promise<Order[]> {
    return this.read()
      .orders.filter((o) => o.daySessionId === daySessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async voidOrder(orderId: string, reason: string, approverPin: string | null): Promise<void> {
    const staff = this.requireStaff();
    if (!reason.trim()) throw new StoreError("A reason is required.", "invalid");
    let approvedBy: string | null = null;
    if (staff.role !== "owner") {
      const owner = approverPin ? this.owner(approverPin) : null;
      if (!owner) throw new StoreError("Owner PIN required to void.", "not_allowed");
      approvedBy = owner.name;
    }
    const state = this.read();
    const order = state.orders.find((o) => o.id === orderId);
    if (!order) throw new StoreError("Order not found.", "invalid");
    if (order.voided) return;
    order.voided = { reason: reason.trim(), by: staff.name, approvedBy, at: new Date().toISOString() };
    this.write(state);
  }

  async addExpense(e: Omit<Expense, "id" | "createdAt" | "staffId" | "staffName" | "daySessionId">): Promise<Expense> {
    const staff = this.requireStaff();
    const state = this.read();
    const day = this.requireDay(state);
    if (e.amountPaise <= 0) throw new StoreError("Amount must be more than zero.", "invalid");
    const row: Expense = {
      ...e,
      id: uuid(),
      createdAt: new Date().toISOString(),
      staffId: staff.id,
      staffName: staff.name,
      daySessionId: day.id,
    };
    state.expenses.push(row);
    this.write(state);
    return row;
  }

  async listExpenses(daySessionId: string): Promise<Expense[]> {
    return this.read().expenses.filter((e) => e.daySessionId === daySessionId);
  }

  async addCashMovement(
    m: Omit<CashMovement, "id" | "createdAt" | "staffId" | "staffName" | "daySessionId">,
  ): Promise<CashMovement> {
    const staff = this.requireStaff();
    const state = this.read();
    const day = this.requireDay(state);
    if (m.amountPaise <= 0) throw new StoreError("Amount must be more than zero.", "invalid");
    const row: CashMovement = {
      ...m,
      id: uuid(),
      createdAt: new Date().toISOString(),
      staffId: staff.id,
      staffName: staff.name,
      daySessionId: day.id,
    };
    state.movements.push(row);
    this.write(state);
    return row;
  }

  async listCashMovements(daySessionId: string): Promise<CashMovement[]> {
    return this.read().movements.filter((m) => m.daySessionId === daySessionId);
  }

  async setSoldOut(sellableId: string, soldOut: boolean): Promise<void> {
    this.requireStaff();
    const state = this.read();
    const set = new Set(state.soldOut);
    if (soldOut) set.add(sellableId);
    else set.delete(sellableId);
    state.soldOut = [...set];
    this.write(state);
  }

  private requireStaff(): Staff {
    if (!this.staff) throw new StoreError("Please log in with your PIN.", "no_session");
    return this.staff;
  }

  private requireDay(state: DemoState): DaySession {
    const day = state.days.find((d) => d.closedAt === null);
    if (!day) throw new StoreError("Open the day first.", "no_open_day");
    return day;
  }

  private memory: DemoState | null = null;

  private read(): DemoState {
    if (this.storage) {
      try {
        const raw = this.storage.getItem(KEY);
        if (raw) return { ...empty(), ...(JSON.parse(raw) as DemoState) };
      } catch {
        // fall through to memory
      }
    }
    return this.memory ?? (this.memory = empty());
  }

  private write(state: DemoState): void {
    this.memory = state;
    if (!this.storage) return;
    try {
      this.storage.setItem(KEY, JSON.stringify(state));
    } catch {
      // storage full or blocked: keep working from memory
    }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
