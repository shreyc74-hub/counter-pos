import type { AdminMenu, DayFact, ExpenseFact, Facts, OrderFact, StockOutFact } from "./types";
import { addDays, todayIst, weekday } from "./metrics";

// Builds 90 days of fake history for the demo outlet, in the browser, with the same
// planted patterns as supabase/seed.sql (so the demo dashboard has a story to tell):
//   evening peak 7–9 pm, weekends +30%, a few rain days
//   snack add-on (spring roll / fries) on ~12% of orders
//   Paneer Kurkure Full sells out on Fridays around 8:30 pm
//   Sita voids ~6% of bills vs ~1.5% for Ramesh, and her days run cash-short
//   packaging spend up ~30% in the last 30 days; ~15% Swiggy/Zomato

const HOUR_WEIGHTS = [4, 14, 18, 10, 7, 9, 15, 24, 36, 33, 26, 18]; // 11:00 … 22:00
const PICKS = [
  ["veg-stm-f", 6],
  ["pan-stm-f", 4],
  ["veg-fry-f", 3],
  ["pan-fry-f", 3],
  ["pan-kur-f", 3],
  ["veg-kur-f", 2],
  ["soy-stm-f", 1],
  ["veg-stm-h", 3],
  ["pan-stm-h", 1],
  ["pan-grv-f", 1],
  ["veg-grv-f", 1],
  ["hakka-nd-f", 2],
  ["veg-nr-nd-f", 2],
  ["veg-nr-rc-f", 1],
  ["chilli-paneer-h", 1],
  ["honey-potato-h", 1],
  ["veg-manch-h", 1],
] as const;
const SNACKS = ["spring-roll-f", "spring-roll-h", "fries-h", "kurkure-roll-h"];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (date: string, h: number, m: number) =>
  Date.parse(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`);

export function generateDemoHistory(menu: AdminMenu, days = 90, today = todayIst()): Facts {
  const random = rng(42);
  const price = (id: string) =>
    menu.variants.find((v) => v.id === id)?.pricePaise ?? menu.combos.find((c) => c.id === id)?.pricePaise ?? null;
  const cost = (id: string) => menu.variants.find((v) => v.id === id)?.costPaise ?? menu.combos.find((c) => c.id === id)?.costPaise ?? null;
  const picks = PICKS.filter(([id]) => price(id) != null);
  const totalWeight = picks.reduce((s, [, w]) => s + w, 0);
  const pick = () => {
    let r = random() * totalWeight;
    for (const [id, w] of picks) if ((r -= w) < 0) return id;
    return picks[0][0];
  };

  const out: Facts = { days: [], orders: [], expenses: [], movements: [], stockOuts: [] };
  let seq = 0;
  for (let i = days; i >= 1; i--) {
    const date = addDays(today, -i);
    const dow = weekday(date);
    const staff = i % 3 === 0 ? "Sita" : "Ramesh";
    const factor = (dow >= 5 ? 1.3 : dow === 1 ? 0.85 : 1) * (random() < 0.06 ? 1.2 : 1) * (0.88 + random() * 0.24);
    const dayId = `demo-day-${date}`;
    const soldOutAt = dow === 5 ? at(date, 20, 30) + Math.floor(random() * 15) * 60_000 : null;
    if (soldOutAt) out.stockOuts.push({ refId: "pan-kur-f", at: soldOutAt } satisfies StockOutFact);

    let cashSales = 0;
    HOUR_WEIGHTS.forEach((w, hi) => {
      const n = Math.round(w * factor * (0.8 + random() * 0.4));
      for (let k = 0; k < n; k++) {
        const t = at(date, 11 + hi, 0) + Math.floor(random() * 59 * 60_000);
        const lines: OrderFact["lines"] = [];
        const addLine = (id: string) => {
          const p = price(id);
          if (p == null) return;
          const c = cost(id);
          const existing = lines.find((l) => l.refId === id);
          if (existing) {
            existing.qty += 1;
            existing.total += p;
            existing.cost = existing.cost == null || c == null ? null : existing.cost + c;
          } else {
            lines.push({ refId: id, kind: menu.combos.some((x) => x.id === id) ? "combo" : "variant", qty: 1, total: p, cost: c });
          }
        };
        const nLines = 1 + (random() < 0.35 ? 1 : 0) + (random() < 0.08 ? 1 : 0);
        for (let ln = 0; ln < nLines; ln++) {
          let id: string = pick();
          if (id === "pan-kur-f" && soldOutAt && t > soldOutAt) id = "pan-fry-f";
          addLine(id);
        }
        if (random() < 0.12) addLine(SNACKS[Math.floor(random() * SNACKS.length)]);
        if (!lines.length) continue;
        const subtotal = lines.reduce((s, l) => s + l.total, 0);
        const discount = random() < 0.05 ? Math.min(1000, subtotal) : 0;
        const total = subtotal - discount;
        const r = random();
        const [cash, upi] = r < 0.63 ? [0, total] : r < 0.96 || total < 2000 ? [total, 0] : [1000, total - 1000];
        const voided = random() < (staff === "Sita" ? 0.06 : 0.015);
        if (!voided) cashSales += cash;
        const ch = random();
        seq++;
        out.orders.push({
          id: `demo-order-${seq}`,
          at: t,
          dayId,
          staff,
          channel: ch < 0.075 ? "swiggy" : ch < 0.15 ? "zomato" : "counter",
          subtotal,
          discount,
          total,
          cash,
          upi,
          voided,
          voidedBy: voided ? staff : null,
          lines,
        });
      }
    });

    const packFactor = i <= 30 ? 1.3 : 1;
    const expenses: ExpenseFact[] = [
      { dayId, category: "ingredients", amount: 120000 + Math.floor(random() * 80000), method: "cash", at: at(date, 10, 45) },
      { dayId, category: "packaging", amount: Math.round((40000 + Math.floor(random() * 15000)) * packFactor), method: "cash", at: at(date, 17, 30) },
    ];
    if (i % 4 === 0) expenses.push({ dayId, category: "gas", amount: 110000, method: "upi", at: at(date, 13, 15) });
    out.expenses.push(...expenses);

    const expected = 100000 + cashSales - expenses.filter((e) => e.method === "cash").reduce((s, e) => s + e.amount, 0);
    const variance =
      staff === "Sita" && random() < 0.5 ? -(10000 + Math.floor(random() * 40000)) : random() < 0.1 ? -5000 : 0;
    const leftovers: [string, number][] =
      random() < 0.6
        ? ["v-veg-stm-full", "v-chk-stm-full", "v-pan-stm-full"]
            .filter(() => random() < 0.6)
            .map((id) => [id, 1 + Math.floor(random() * 4)])
        : [];
    out.days.push({
      id: dayId,
      date,
      openedAt: new Date(at(date, 11, 0)).toISOString(),
      closedAt: new Date(at(date, 22, 50)).toISOString(),
      openingFloatPaise: 100000,
      expectedCashPaise: expected,
      countedCashPaise: expected + variance,
      variancePaise: variance,
      closedBy: "Shrey",
      leftovers,
    } satisfies DayFact);
  }
  return out;
}
