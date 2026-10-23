import { demoOutlet, demoStaff } from "@/lib/data/demoMenu";
import { DEMO_MENU_KEY, loadDemoAdminMenu } from "@/lib/data/demoMenuStorage";
import { readDemoCounterState } from "@/lib/data/demoStore";
import type { Outlet } from "@/lib/domain/types";
import { uuid } from "@/lib/uuid";
import { generateDemoHistory } from "./demoHistory";
import { todayIst } from "./metrics";
import type { AdminMenu, AdminStore, Facts, OrderFact, PricePoint } from "./types";

const PRICES_KEY = "cpos.demo.prices.v1";
const SESSION_KEY = "cpos.demo.admin";

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): KV | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function read<T>(s: KV | null, key: string): T | null {
  try {
    const raw = s?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Admin panel running entirely in the browser, on demo data. */
export class DemoAdminStore implements AdminStore {
  readonly kind = "demo" as const;
  private history: { date: string; facts: Facts } | null = null;

  constructor(private readonly s: KV | null = storage()) {}

  async currentUser(): Promise<string | null> {
    return this.s?.getItem(SESSION_KEY) ?? null;
  }

  async startSignIn(): Promise<void> {}

  async verifySignIn(_email: string, code: string): Promise<boolean> {
    const owner = demoStaff.find((x) => x.role === "owner" && x.pin === code);
    if (owner) this.s?.setItem(SESSION_KEY, `${owner.name} (demo)`);
    return !!owner;
  }

  async signOut(): Promise<void> {
    this.s?.removeItem(SESSION_KEY);
  }

  async outlets(): Promise<Outlet[]> {
    return [demoOutlet];
  }

  async menu(): Promise<AdminMenu> {
    return loadDemoAdminMenu(this.s);
  }

  async priceHistory(_outlet: string, refId: string): Promise<PricePoint[]> {
    const all = read<Record<string, PricePoint[]>>(this.s, PRICES_KEY) ?? {};
    const current = this.findPrice(loadDemoAdminMenu(this.s), refId);
    const past = all[refId] ?? [];
    return past.length ? past : current ? [{ ...current, from: "2025-01-01T00:00:00Z" }] : [];
  }

  async saveCategory(_o: string, c: Parameters<AdminStore["saveCategory"]>[1]): Promise<string> {
    return this.mutate((m) => upsert(m.categories, { ...c, name: required(c.name) }));
  }

  async saveItem(_o: string, i: Parameters<AdminStore["saveItem"]>[1]): Promise<string> {
    return this.mutate((m) => upsert(m.items, { ...i, name: required(i.name) }));
  }

  async saveVariant(_o: string, v: Parameters<AdminStore["saveVariant"]>[1]): Promise<string> {
    if (v.pricePaise == null || v.pricePaise < 0) throw new Error("Price must be zero or more.");
    if (v.costPaise != null && v.costPaise < 0) throw new Error("Cost must be zero or more.");
    return this.mutate((m) => {
      const before = v.id ? m.variants.find((x) => x.id === v.id) : null;
      const id = upsert(m.variants, { ...v, name: required(v.name), priceSince: new Date().toISOString() });
      this.recordPrice(id, before ? { pricePaise: before.pricePaise ?? 0, costPaise: before.costPaise } : null, v.pricePaise ?? 0, v.costPaise);
      return id;
    });
  }

  async saveModifier(_o: string, x: Parameters<AdminStore["saveModifier"]>[1]): Promise<string> {
    return this.mutate((m) => upsert(m.modifiers, { ...x, name: required(x.name) }));
  }

  async saveCombo(_o: string, c: Parameters<AdminStore["saveCombo"]>[1]): Promise<string> {
    if (!c.parts.length) throw new Error("A combo needs at least one item.");
    return this.mutate((m) => upsert(m.combos, { ...c, name: required(c.name) }));
  }

  async setFavourites(_o: string, ids: string[]): Promise<void> {
    this.mutate((m) => {
      m.favourites = [...new Set(ids)];
      return "";
    });
  }

  async facts(_o: string, from: string, to: string): Promise<Facts> {
    const today = todayIst();
    if (!this.history || this.history.date !== today) {
      this.history = { date: today, facts: generateDemoHistory(loadDemoAdminMenu(this.s), 90, today) };
    }
    const h = this.history.facts;
    const local = counterFacts(this.s);
    const all: Facts = {
      days: [...h.days, ...local.days],
      orders: [...h.orders, ...local.orders],
      expenses: [...h.expenses, ...local.expenses],
      movements: [...h.movements, ...local.movements],
      stockOuts: [...h.stockOuts, ...local.stockOuts],
    };
    const dayIds = new Set(all.days.filter((d) => d.date >= from && d.date <= to).map((d) => d.id));
    return {
      days: all.days.filter((d) => dayIds.has(d.id)),
      orders: all.orders.filter((o) => dayIds.has(o.dayId)),
      expenses: all.expenses.filter((e) => dayIds.has(e.dayId)),
      movements: all.movements.filter((m) => dayIds.has(m.dayId)),
      stockOuts: all.stockOuts,
    };
  }

  private mutate(fn: (m: AdminMenu) => string): string {
    const m = loadDemoAdminMenu(this.s);
    const id = fn(m);
    m.version += 1;
    this.s?.setItem(DEMO_MENU_KEY, JSON.stringify(m));
    return id;
  }

  private findPrice(m: AdminMenu, refId: string): { pricePaise: number; costPaise: number | null } | null {
    const v = m.variants.find((x) => x.id === refId);
    if (v) return { pricePaise: v.pricePaise ?? 0, costPaise: v.costPaise };
    return null;
  }

  private recordPrice(refId: string, before: { pricePaise: number; costPaise: number | null } | null, price: number, cost: number | null) {
    if (before && before.pricePaise === price && before.costPaise === cost) return;
    const all = read<Record<string, PricePoint[]>>(this.s, PRICES_KEY) ?? {};
    const list = all[refId] ?? (before ? [{ ...before, from: "2025-01-01T00:00:00Z" }] : []);
    all[refId] = [{ pricePaise: price, costPaise: cost, from: new Date().toISOString() }, ...list];
    this.s?.setItem(PRICES_KEY, JSON.stringify(all));
  }
}

function required(name: string): string {
  const n = name.trim();
  if (!n) throw new Error("Name is required.");
  return n;
}

function upsert<T extends { id: string }>(list: T[], row: Omit<T, "id"> & { id: string | null }): string {
  const id = row.id ?? uuid();
  const next = { ...row, id } as T;
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) list[i] = next;
  else list.push(next);
  return id;
}

/** Orders taken on the demo counter in this browser, as dashboard facts. */
function counterFacts(s: KV | null): Facts {
  const st = readDemoCounterState(s);
  return {
    days: st.days.map((d) => ({
      id: d.id,
      date: d.businessDate,
      openedAt: d.openedAt,
      closedAt: d.closedAt,
      openingFloatPaise: d.openingFloatPaise,
      expectedCashPaise: d.expectedCashPaise,
      countedCashPaise: d.countedCashPaise,
      variancePaise: d.variancePaise,
      closedBy: d.closedBy,
      leftovers: d.leftovers.map((l) => [l.variantId, l.plates] as [string, number]),
    })),
    orders: st.orders.map(
      (o): OrderFact => ({
        id: o.id,
        at: Date.parse(o.createdAt),
        dayId: o.daySessionId,
        staff: o.staffName,
        channel: o.channel,
        subtotal: o.subtotalPaise,
        discount: o.discount?.amountPaise ?? 0,
        total: o.totalPaise,
        cash: o.payments.filter((p) => p.method === "cash").reduce((a, p) => a + p.amountPaise, 0),
        upi: o.payments.filter((p) => p.method === "upi").reduce((a, p) => a + p.amountPaise, 0),
        voided: !!o.voided,
        voidedBy: o.voided?.by ?? null,
        lines: o.lines.map((l) => {
          const modCost = l.modifiers.reduce<number | null>((a, m) => (a == null || m.costPaise == null ? a : a + m.costPaise), 0);
          return {
            refId: l.refId,
            kind: l.kind,
            qty: l.qty,
            total: (l.unitPricePaise + l.modifiers.reduce((a, m) => a + m.pricePaise, 0)) * l.qty,
            cost: l.unitCostPaise == null ? null : (l.unitCostPaise + (modCost ?? 0)) * l.qty,
          };
        }),
      }),
    ),
    expenses: st.expenses.map((e) => ({ dayId: e.daySessionId, category: e.category, amount: e.amountPaise, method: e.method, at: Date.parse(e.createdAt) })),
    movements: st.movements.map((m) => ({ dayId: m.daySessionId, direction: m.direction, amount: m.amountPaise })),
    stockOuts: [],
  };
}
