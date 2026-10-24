import type { Paise } from "@/lib/domain/types";
import type { AdminMenu, DayFact, ExpenseFact, Facts, OrderFact } from "./types";

// Every number on the dashboard is computed here from the same facts, so tiles,
// charts and tables always agree. Times are shown in India time (UTC+5:30).

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function istDate(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function istHour(ms: number): number {
  return new Date(ms + IST_OFFSET_MS).getUTCHours();
}

export function todayIst(now = Date.now()): string {
  return istDate(now);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** 1 = Monday … 7 = Sunday. */
export function weekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * Facts for days whose business date is in [from, to]. With includeOpen, a day that is
 * still open counts too even if it was opened on an earlier date (e.g. never closed
 * last night), so "Today" never hides sales that are happening now.
 */
export function inRange(f: Facts, from: string, to: string, includeOpen = false): Facts {
  const dayIds = new Set(
    f.days.filter((d) => (d.date >= from && d.date <= to) || (includeOpen && d.closedAt == null)).map((d) => d.id),
  );
  return {
    days: f.days.filter((d) => dayIds.has(d.id)),
    orders: f.orders.filter((o) => dayIds.has(o.dayId)),
    expenses: f.expenses.filter((e) => dayIds.has(e.dayId)),
    movements: f.movements.filter((m) => dayIds.has(m.dayId)),
    stockOuts: f.stockOuts.filter((s) => istDate(s.at) >= from && istDate(s.at) <= to),
  };
}

const live = (orders: OrderFact[]) => orders.filter((o) => !o.voided);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export interface Summary {
  orders: number;
  sales: Paise;
  aov: Paise;
  cash: Paise;
  upi: Paise;
  discounts: Paise;
  voids: number;
  voided: Paise;
  /** Sales minus cost, over the lines that have a cost. */
  grossMargin: Paise;
  /** Share of sales (0–1) whose cost is known, so the margin can be trusted. */
  costCoverage: number;
  moneyOut: Paise;
  moneyOutCash: Paise;
  moneyOutUpi: Paise;
  /** Sales minus expenses. */
  net: Paise;
}

export function summarize(f: Pick<Facts, "orders" | "expenses">): Summary {
  const ok = live(f.orders);
  const sales = sum(ok.map((o) => o.total));
  let knownSales = 0;
  let knownMargin = 0;
  for (const o of ok) {
    // Spread an order discount over its lines in proportion, so margin reflects what was charged.
    const factor = o.subtotal > 0 ? o.total / o.subtotal : 1;
    for (const l of o.lines) {
      if (l.cost == null) continue;
      knownSales += l.total * factor;
      knownMargin += l.total * factor - l.cost;
    }
  }
  const outCash = sum(f.expenses.filter((e) => e.method === "cash").map((e) => e.amount));
  const outUpi = sum(f.expenses.filter((e) => e.method === "upi").map((e) => e.amount));
  return {
    orders: ok.length,
    sales,
    aov: ok.length ? Math.round(sales / ok.length) : 0,
    cash: sum(ok.map((o) => o.cash)),
    upi: sum(ok.map((o) => o.upi)),
    discounts: sum(ok.map((o) => o.discount)),
    voids: f.orders.length - ok.length,
    voided: sum(f.orders.filter((o) => o.voided).map((o) => o.total)),
    grossMargin: Math.round(knownMargin),
    costCoverage: sales ? knownSales / sales : 0,
    moneyOut: outCash + outUpi,
    moneyOutCash: outCash,
    moneyOutUpi: outUpi,
    net: sales - outCash - outUpi,
  };
}

/** Cash that should be in the drawer for an open (or closed) day. */
export function expectedCash(day: DayFact, f: Pick<Facts, "orders" | "expenses" | "movements">): Paise {
  const orders = live(f.orders.filter((o) => o.dayId === day.id));
  const exp = f.expenses.filter((e) => e.dayId === day.id && e.method === "cash");
  const mv = f.movements.filter((m) => m.dayId === day.id);
  return (
    day.openingFloatPaise +
    sum(orders.map((o) => o.cash)) +
    sum(mv.filter((m) => m.direction === "in").map((m) => m.amount)) -
    sum(exp.map((e) => e.amount)) -
    sum(mv.filter((m) => m.direction === "out").map((m) => m.amount))
  );
}

/** Orders and sales per hour of the day (0–23). */
export function byHour(orders: OrderFact[]): { orders: number[]; sales: Paise[] } {
  const o = new Array(24).fill(0);
  const s = new Array(24).fill(0);
  for (const x of live(orders)) {
    const h = istHour(x.at);
    o[h] += 1;
    s[h] += x.total;
  }
  return { orders: o, sales: s };
}

/**
 * Typical orders per hour for a weekday: the average of the same weekday over the
 * previous `weeks` weeks (only days that were actually open).
 */
export function typicalByHour(f: Facts, date: string, weeks = 4): number[] | null {
  const dates = Array.from({ length: weeks }, (_, i) => addDays(date, -7 * (i + 1)));
  const days = f.days.filter((d) => dates.includes(d.date));
  if (!days.length) return null;
  const ids = new Set(days.map((d) => d.id));
  const h = byHour(f.orders.filter((o) => ids.has(o.dayId))).orders;
  return h.map((x) => x / days.length);
}

/** Minutes since midnight, India time. */
export function istMinutes(ms: number): number {
  return Math.floor(((ms + IST_OFFSET_MS) % DAY_MS) / 60_000);
}

/**
 * Average of a summary metric over the same weekday in previous weeks.
 * With `untilMinutes`, only counts what happened up to that time of day
 * (so "today so far" is compared fairly with a usual day so far).
 */
export function typicalSummary(f: Facts, date: string, weeks = 4, untilMinutes?: number): Summary | null {
  const dates = Array.from({ length: weeks }, (_, i) => addDays(date, -7 * (i + 1)));
  const days = f.days.filter((d) => dates.includes(d.date));
  if (!days.length) return null;
  const ids = new Set(days.map((d) => d.id));
  const before = (ms: number) => untilMinutes == null || istMinutes(ms) <= untilMinutes;
  const s = summarize({
    orders: f.orders.filter((o) => ids.has(o.dayId) && before(o.at)),
    expenses: f.expenses.filter((e) => ids.has(e.dayId) && before(e.at)),
  });
  const n = days.length;
  const avg = (x: number) => Math.round(x / n);
  return {
    ...s,
    orders: avg(s.orders),
    sales: avg(s.sales),
    cash: avg(s.cash),
    upi: avg(s.upi),
    discounts: avg(s.discounts),
    voids: avg(s.voids),
    voided: avg(s.voided),
    grossMargin: avg(s.grossMargin),
    moneyOut: avg(s.moneyOut),
    moneyOutCash: avg(s.moneyOutCash),
    moneyOutUpi: avg(s.moneyOutUpi),
    net: avg(s.net),
  };
}

export interface DayRow {
  date: string;
  orders: number;
  sales: Paise;
  cash: Paise;
  upi: Paise;
  moneyOut: Paise;
  variance: Paise | null;
  open: boolean;
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export function dayRows(f: Facts): DayRow[] {
  const orders = groupBy(f.orders, (o) => o.dayId);
  const expenses = groupBy(f.expenses, (e) => e.dayId);
  return f.days.map((d) => {
    const s = summarize({ orders: orders.get(d.id) ?? [], expenses: expenses.get(d.id) ?? [] });
    return {
      date: d.date,
      orders: s.orders,
      sales: s.sales,
      cash: s.cash,
      upi: s.upi,
      moneyOut: s.moneyOut,
      variance: d.variancePaise,
      open: d.closedAt == null,
    };
  });
}

export interface ItemRow {
  refId: string;
  name: string;
  category: string;
  qty: number;
  revenue: Paise;
  /** null when no cost is entered for this item. */
  margin: Paise | null;
  marginPct: number | null;
  share: number;
}

export function itemPerformance(orders: OrderFact[], menu: AdminMenu | null): ItemRow[] {
  const rows = new Map<string, { qty: number; revenue: number; cost: number; costMissing: boolean }>();
  for (const o of live(orders)) {
    const factor = o.subtotal > 0 ? o.total / o.subtotal : 1;
    for (const l of o.lines) {
      const r = rows.get(l.refId) ?? { qty: 0, revenue: 0, cost: 0, costMissing: false };
      r.qty += l.qty;
      r.revenue += l.total * factor;
      if (l.cost == null) r.costMissing = true;
      else r.cost += l.cost;
      rows.set(l.refId, r);
    }
  }
  const total = sum([...rows.values()].map((r) => r.revenue));
  return [...rows.entries()]
    .map(([refId, r]) => {
      const { name, category } = sellableName(menu, refId);
      const margin = r.costMissing ? null : Math.round(r.revenue - r.cost);
      return {
        refId,
        name,
        category,
        qty: r.qty,
        revenue: Math.round(r.revenue),
        margin,
        marginPct: margin != null && r.revenue > 0 ? margin / r.revenue : null,
        share: total ? r.revenue / total : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

export function sellableName(menu: AdminMenu | null, refId: string): { name: string; category: string } {
  if (!menu) return { name: "Item", category: "" };
  const v = menu.variants.find((x) => x.id === refId);
  if (v) {
    const item = menu.items.find((i) => i.id === v.itemId);
    const cat = menu.categories.find((c) => c.id === item?.categoryId);
    return { name: `${item?.name ?? "Item"} · ${v.name}`, category: cat?.name ?? "" };
  }
  const c = menu.combos.find((x) => x.id === refId);
  return { name: c?.name ?? "Removed item", category: c ? "Combos" : "" };
}

/**
 * Share of orders (0–1) that include something from a category, e.g. the
 * "drink add-on rate". Combos containing the category count too.
 */
export function attachRate(orders: OrderFact[], menu: AdminMenu, categoryName: string): number | null {
  const cat = menu.categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
  if (!cat) return null;
  const itemIds = new Set(menu.items.filter((i) => i.categoryId === cat.id).map((i) => i.id));
  const variantIds = new Set(menu.variants.filter((v) => itemIds.has(v.itemId)).map((v) => v.id));
  const comboIds = new Set(menu.combos.filter((c) => c.parts.some((p) => variantIds.has(p.variantId))).map((c) => c.id));
  const ok = live(orders);
  if (!ok.length) return null;
  const hits = ok.filter((o) => o.lines.some((l) => variantIds.has(l.refId) || comboIds.has(l.refId))).length;
  return hits / ok.length;
}

export interface StaffRow {
  staff: string;
  orders: number;
  sales: Paise;
  voids: number;
  voidRate: number;
  voided: Paise;
  discounts: number;
  discounted: Paise;
  /** Sum of cash shortfalls on days this person took most of the orders (negative = short). */
  cashShort: Paise;
  shortDays: number;
}

export function staffLeakage(f: Pick<Facts, "orders" | "days">): StaffRow[] {
  const by = new Map<string, OrderFact[]>();
  for (const o of f.orders) {
    const list = by.get(o.staff);
    if (list) list.push(o);
    else by.set(o.staff, [o]);
  }
  // Who ran each day: the person with the most bills.
  const perDay = new Map<string, Map<string, number>>();
  for (const o of f.orders) {
    const counts = perDay.get(o.dayId) ?? new Map<string, number>();
    counts.set(o.staff, (counts.get(o.staff) ?? 0) + 1);
    perDay.set(o.dayId, counts);
  }
  const dayOwner = new Map<string, string>();
  for (const [dayId, counts] of perDay) {
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) dayOwner.set(dayId, top[0]);
  }
  return [...by.entries()]
    .map(([staff, os]) => {
      const ok = live(os);
      const shortDays = f.days.filter((d) => dayOwner.get(d.id) === staff && (d.variancePaise ?? 0) < 0);
      return {
        staff,
        orders: ok.length,
        sales: sum(ok.map((o) => o.total)),
        voids: os.length - ok.length,
        voidRate: os.length ? (os.length - ok.length) / os.length : 0,
        voided: sum(os.filter((o) => o.voided).map((o) => o.total)),
        discounts: ok.filter((o) => o.discount > 0).length,
        discounted: sum(ok.map((o) => o.discount)),
        cashShort: sum(shortDays.map((d) => d.variancePaise ?? 0)),
        shortDays: shortDays.length,
      };
    })
    .sort((a, b) => b.orders - a.orders);
}

export function expensesByCategory(expenses: ExpenseFact[]): { category: string; amount: Paise }[] {
  const m = new Map<string, number>();
  for (const e of expenses) m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
  return [...m.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

export function channelMix(orders: OrderFact[]): { channel: string; orders: number; sales: Paise }[] {
  const m = new Map<string, { orders: number; sales: number }>();
  for (const o of live(orders)) {
    const r = m.get(o.channel) ?? { orders: 0, sales: 0 };
    r.orders += 1;
    r.sales += o.total;
    m.set(o.channel, r);
  }
  return [...m.entries()].map(([channel, r]) => ({ channel, ...r })).sort((a, b) => b.sales - a.sales);
}

export function stockOutCounts(f: Pick<Facts, "stockOuts">, menu: AdminMenu | null): { name: string; times: number; typicalTime: string }[] {
  const m = new Map<string, number[]>();
  for (const s of f.stockOuts) m.set(s.refId, [...(m.get(s.refId) ?? []), s.at]);
  return [...m.entries()]
    .map(([refId, ats]) => {
      const mins = ats.map((a) => istHour(a) * 60 + new Date(a + IST_OFFSET_MS).getUTCMinutes()).sort((a, b) => a - b);
      const median = mins[Math.floor(mins.length / 2)];
      const h = Math.floor(median / 60);
      const mm = String(median % 60).padStart(2, "0");
      return { name: sellableName(menu, refId).name, times: ats.length, typicalTime: `${((h + 11) % 12) + 1}:${mm} ${h >= 12 ? "pm" : "am"}` };
    })
    .sort((a, b) => b.times - a.times);
}

/** Relative change, or null when there is no baseline. */
export function change(now: number, before: number | null | undefined): number | null {
  if (before == null || before === 0) return null;
  return (now - before) / Math.abs(before);
}

