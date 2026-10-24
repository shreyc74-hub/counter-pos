import { describe, expect, it } from "vitest";
import { demoMenu as realMenu } from "@/lib/data/demoMenu";
import { fixtureMenu as demoMenu } from "@/lib/testing/fixtureMenu";
import { generateDemoHistory } from "./demoHistory";
import { toAdminMenu, toCounterMenu } from "./menu";
import {
  addDays,
  attachRate,
  byHour,
  change,
  dayRows,
  expectedCash,
  inRange,
  istDate,
  istHour,
  itemPerformance,
  staffLeakage,
  summarize,
  typicalByHour,
  weekday,
} from "./metrics";
import type { DayFact, OrderFact } from "./types";

const menu = toAdminMenu(demoMenu);

function order(p: Partial<OrderFact>): OrderFact {
  return {
    id: Math.random().toString(36),
    at: Date.parse("2026-10-22T19:30:00+05:30"),
    dayId: "d1",
    staff: "Ramesh",
    channel: "counter",
    subtotal: 10000,
    discount: 0,
    total: 10000,
    cash: 10000,
    upi: 0,
    voided: false,
    voidedBy: null,
    lines: [{ refId: "v-veg-stm-full", kind: "variant", qty: 1, total: 10000, cost: 4200 }],
    ...p,
  };
}

const day = (p: Partial<DayFact> = {}): DayFact => ({
  id: "d1",
  date: "2026-10-22",
  openedAt: "2026-10-22T05:30:00Z",
  closedAt: null,
  openingFloatPaise: 100000,
  expectedCashPaise: null,
  countedCashPaise: null,
  variancePaise: null,
  closedBy: null,
  leftovers: [],
  ...p,
});

describe("dates in India time", () => {
  it("converts to IST date and hour", () => {
    expect(istDate(Date.parse("2026-10-22T20:00:00Z"))).toBe("2026-10-23");
    expect(istHour(Date.parse("2026-10-22T14:00:00Z"))).toBe(19);
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(weekday("2026-10-23")).toBe(5); // Friday
  });
});

describe("summarize", () => {
  it("ignores voided bills and splits cash and UPI", () => {
    const s = summarize({
      orders: [
        order({}),
        order({ total: 20000, subtotal: 20000, cash: 5000, upi: 15000 }),
        order({ voided: true, total: 99900, subtotal: 99900, cash: 99900 }),
      ],
      expenses: [{ dayId: "d1", category: "gas", amount: 110000, method: "upi", at: 0 }],
    });
    expect(s.orders).toBe(2);
    expect(s.sales).toBe(30000);
    expect(s.aov).toBe(15000);
    expect(s.cash).toBe(15000);
    expect(s.upi).toBe(15000);
    expect(s.voids).toBe(1);
    expect(s.voided).toBe(99900);
    expect(s.moneyOut).toBe(110000);
    expect(s.net).toBe(30000 - 110000);
  });

  it("computes margin after discount, and reports cost coverage", () => {
    const s = summarize({
      orders: [
        order({ subtotal: 10000, discount: 1000, total: 9000, cash: 9000 }),
        order({ lines: [{ refId: "v-chilli-pan-dry", kind: "variant", qty: 1, total: 10000, cost: null }] }),
      ],
      expenses: [],
    });
    // first bill: 90 charged − 42 cost = 48; second has no cost → excluded
    expect(s.grossMargin).toBe(4800);
    expect(s.costCoverage).toBeCloseTo(9000 / 19000);
  });
});

describe("ranges", () => {
  it("can include a day left open from an earlier date", () => {
    const f = { days: [day({ date: "2026-10-22", closedAt: null })], orders: [order({})], expenses: [], movements: [], stockOuts: [] };
    expect(inRange(f, "2026-10-23", "2026-10-23").orders).toHaveLength(0);
    expect(inRange(f, "2026-10-23", "2026-10-23", true).orders).toHaveLength(1);
    const closed = { ...f, days: [day({ date: "2026-10-22", closedAt: "x" })] };
    expect(inRange(closed, "2026-10-23", "2026-10-23", true).orders).toHaveLength(0);
  });
});

describe("day and cash", () => {
  it("computes expected drawer cash the same way as the counter", () => {
    const d = day();
    const cash = expectedCash(d, {
      orders: [order({}), order({ cash: 0, upi: 10000 }), order({ voided: true })],
      expenses: [
        { dayId: "d1", category: "packaging", amount: 2000, method: "cash", at: 0 },
        { dayId: "d1", category: "gas", amount: 9000, method: "upi", at: 0 },
      ],
      movements: [
        { dayId: "d1", direction: "out", amount: 500 },
        { dayId: "d1", direction: "in", amount: 300 },
      ],
    });
    expect(cash).toBe(100000 + 10000 + 300 - 2000 - 500);
  });

  it("builds one row per day", () => {
    const rows = dayRows({ days: [day({ variancePaise: -1400, closedAt: "x" })], orders: [order({})], expenses: [], movements: [], stockOuts: [] });
    expect(rows).toEqual([{ date: "2026-10-22", orders: 1, sales: 10000, cash: 10000, upi: 0, moneyOut: 0, variance: -1400, open: false }]);
  });
});

describe("items and attach rate", () => {
  it("ranks items by sales and flags missing cost", () => {
    const rows = itemPerformance(
      [
        order({}),
        order({
          subtotal: 16500,
          total: 16500,
          lines: [
            { refId: "v-veg-stm-full", kind: "variant", qty: 1, total: 10000, cost: 4200 },
            { refId: "v-chilli-pan-dry", kind: "variant", qty: 1, total: 14000, cost: null },
          ].slice(0, 2) as OrderFact["lines"],
        }),
      ],
      menu,
    );
    const veg = rows.find((r) => r.refId === "v-veg-stm-full")!;
    expect(veg.name).toBe("Veg Momos · Steamed · Full");
    expect(veg.qty).toBe(2);
    expect(rows.find((r) => r.refId === "v-chilli-pan-dry")!.margin).toBeNull();
  });

  it("counts drink add-ons, including combos with a drink", () => {
    const drink = { refId: "v-drink-250", kind: "variant" as const, qty: 1, total: 2500, cost: 1800 };
    const combo = { refId: "combo-1", kind: "combo" as const, qty: 1, total: 11500, cost: 6000 };
    const rate = attachRate([order({}), order({ lines: [drink] }), order({ lines: [combo] }), order({})], menu, "Drinks");
    expect(rate).toBe(0.5);
  });
});

describe("staff leakage", () => {
  it("rates voids per person and pins cash shortfalls to who ran the day", () => {
    const orders = [
      order({ staff: "Sita", dayId: "d2" }),
      order({ staff: "Sita", dayId: "d2", voided: true, voidedBy: "Sita" }),
      order({ staff: "Ramesh" }),
    ];
    const rows = staffLeakage({ orders, days: [day(), day({ id: "d2", date: "2026-10-23", variancePaise: -2500 })] });
    const sita = rows.find((r) => r.staff === "Sita")!;
    expect(sita.voids).toBe(1);
    expect(sita.voidRate).toBe(0.5);
    expect(sita.cashShort).toBe(-2500);
    expect(rows.find((r) => r.staff === "Ramesh")!.cashShort).toBe(0);
  });
});

describe("demo history on the real menu (planted patterns the dashboard must show)", () => {
  const today = "2026-10-23";
  const real = toAdminMenu(realMenu);
  const f = generateDemoHistory(real, 90, today);

  it("is deterministic", () => {
    expect(generateDemoHistory(real, 90, today).orders.length).toBe(f.orders.length);
  });

  it("only sells things that are on the menu, at menu prices", () => {
    const price = new Map(real.variants.map((v) => [v.id, v.pricePaise]));
    expect(f.orders.every((o) => o.lines.every((l) => price.get(l.refId) === l.total / l.qty))).toBe(true);
  });

  it("peaks in the evening", () => {
    const h = byHour(f.orders).orders;
    expect(h[19]).toBeGreaterThan(h[15] * 2);
  });

  it("Sita voids far more than Ramesh", () => {
    const rows = staffLeakage(f);
    const sita = rows.find((r) => r.staff === "Sita")!;
    const ramesh = rows.find((r) => r.staff === "Ramesh")!;
    expect(sita.voidRate).toBeGreaterThan(ramesh.voidRate * 2);
    expect(sita.cashShort).toBeLessThan(ramesh.cashShort);
  });

  it("packaging spend rises in the last 30 days", () => {
    const pack = (from: string, to: string) =>
      inRange(f, from, to).expenses.filter((e) => e.category === "packaging").reduce((a, e) => a + e.amount, 0) / 30;
    expect(pack(addDays(today, -30), addDays(today, -1))).toBeGreaterThan(pack(addDays(today, -60), addDays(today, -31)) * 1.2);
  });

  it("snack add-on rate is around 12%", () => {
    const r = attachRate(f.orders, real, "Snacks")!;
    expect(r).toBeGreaterThan(0.08);
    expect(r).toBeLessThan(0.2);
  });

  it("Paneer Kurkure Full sells out on Fridays", () => {
    expect(f.stockOuts.length).toBeGreaterThanOrEqual(12);
    expect(f.stockOuts.every((s) => s.refId === "pan-kur-f")).toBe(true);
  });

  it("has a usual-weekday baseline for comparisons", () => {
    expect(typicalByHour(f, today)?.[19]).toBeGreaterThan(10);
  });

  it("payments add up on every bill", () => {
    expect(f.orders.every((o) => o.cash + o.upi === o.total)).toBe(true);
  });
});

describe("menu views", () => {
  it("hides inactive things from the counter", () => {
    const m = toAdminMenu(demoMenu);
    m.variants.find((v) => v.id === "v-veg-stm-full")!.active = false;
    const c = toCounterMenu(m);
    expect(c.variants.some((v) => v.id === "v-veg-stm-full")).toBe(false);
    expect(c.favourites).not.toContain("v-veg-stm-full");
    expect(c.combos.some((x) => x.id === "combo-1")).toBe(false); // its part is hidden
  });
  it("change() handles no baseline", () => {
    expect(change(110, 100)).toBeCloseTo(0.1);
    expect(change(5, 0)).toBeNull();
  });
});
