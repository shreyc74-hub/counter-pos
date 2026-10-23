"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  attachRate,
  byHour,
  change,
  dayRows,
  daysBetween,
  expectedCash,
  expensesByCategory,
  inRange,
  istMinutes,
  itemPerformance,
  channelMix,
  staffLeakage,
  stockOutCounts,
  summarize,
  todayIst,
  typicalByHour,
  typicalSummary,
  type Summary,
} from "@/lib/admin/metrics";
import type { AdminMenu, AdminStore, Facts } from "@/lib/admin/types";
import { formatRupees } from "@/lib/domain/money";
import { BarList, ColumnChart, SERIES, ShareBar } from "./charts";

type RangeId = "today" | "yesterday" | "7d" | "30d" | "90d";
const RANGES: { id: RangeId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
];

function rangeDates(id: RangeId, today: string): { from: string; to: string } {
  switch (id) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
  }
}

const rupees = (p: number) => formatRupees(Math.round(p / 100) * 100);
const compactRupees = (p: number) => {
  const r = p / 100;
  if (r >= 100000) return `₹${(r / 100000).toFixed(r >= 1000000 ? 0 : 1)}L`;
  if (r >= 1000) return `₹${(r / 1000).toFixed(r >= 10000 ? 0 : 1)}K`;
  return `₹${Math.round(r)}`;
};
const pct = (x: number | null, digits = 0) => (x == null ? "–" : `${(x * 100).toFixed(digits)}%`);
const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "a" : "p"}`;
const CATEGORY_LABEL: Record<string, string> = {
  ingredients: "Ingredients",
  packaging: "Packaging",
  gas: "Gas",
  rent: "Rent",
  salary: "Salary",
  electricity: "Electricity",
  maintenance: "Maintenance",
  other: "Other",
};

export function Dashboard({ store, outletId, menu }: { store: AdminStore; outletId: string; menu: AdminMenu | null }) {
  const [range, setRange] = useState<RangeId>("today");
  const [facts, setFacts] = useState<Facts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const today = todayIst();
  const { from, to } = rangeDates(range, today);
  const len = daysBetween(from, to);
  // Load enough history for the comparison: the previous period, or four prior weeks.
  const fetchFrom = addDays(from, -Math.max(len, 28));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFacts(await store.facts(outletId, fetchFrom, to));
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the dashboard.");
    } finally {
      setLoading(false);
    }
  }, [store, outletId, fetchFrom, to]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live: refresh every 30 seconds while looking at today.
  useEffect(() => {
    if (range !== "today") return;
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [range, load]);

  const view = useMemo(
    () => (facts ? computeView(facts, from, to, len, menu, from === today ? istMinutes(updatedAt?.getTime() ?? Date.now()) : undefined) : null),
    [facts, from, to, len, menu, today, updatedAt],
  );

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row between" style={{ flexWrap: "wrap" }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 26 }}>Dashboard</h1>
          <span className="small muted">
            {from === to ? from : `${from} to ${to}`}
            {updatedAt ? ` · updated ${updatedAt.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}` : ""}
            {range === "today" ? " · refreshes every 30 s" : ""}
          </span>
        </div>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="row" style={{ flexWrap: "wrap", gap: 8 }} role="group" aria-label="Date range">
        {RANGES.map((r) => (
          <button key={r.id} type="button" className="chip" aria-pressed={range === r.id} onClick={() => setRange(r.id)}>
            {r.label}
          </button>
        ))}
      </div>

      {error ? <div className="error">{error}</div> : null}
      {!view ? <p className="muted">Loading…</p> : null}

      {view ? (
        <div className="stack" style={{ gap: 18, opacity: loading ? 0.6 : 1, transition: "opacity 120ms" }}>
          {view.cur.days.length === 0 ? (
            <div className="notice">No day was opened in this period yet. Open the day on the counter to start recording sales.</div>
          ) : null}

          <section className="kpis" aria-label="Key numbers">
            <Kpi label="Sales" value={rupees(view.s.sales)} delta={change(view.s.sales, view.baseline?.sales)} note={view.baselineLabel} />
            <Kpi label="Orders" value={String(view.s.orders)} delta={change(view.s.orders, view.baseline?.orders)} note={view.baselineLabel} />
            <Kpi label="Avg order value" value={rupees(view.s.aov)} delta={change(view.s.aov, view.baseline?.aov)} note={view.baselineLabel} />
            <Kpi
              label="Gross margin"
              value={rupees(view.s.grossMargin)}
              note={view.s.costCoverage < 0.999 ? `${pct(view.s.costCoverage)} of sales have a cost entered` : `${pct(view.s.sales ? view.s.grossMargin / view.s.sales : null)} of sales`}
            />
            <Kpi label="Money in · Cash" value={rupees(view.s.cash)} note={`${pct(view.s.sales ? view.s.cash / view.s.sales : null)} of sales`} />
            <Kpi label="Money in · UPI" value={rupees(view.s.upi)} note={`${pct(view.s.sales ? view.s.upi / view.s.sales : null)} of sales`} />
            <Kpi
              label="Money out"
              value={rupees(view.s.moneyOut)}
              delta={change(view.s.moneyOut, view.baseline?.moneyOut)}
              upIsGood={false}
              note={`Cash ${rupees(view.s.moneyOutCash)} · UPI ${rupees(view.s.moneyOutUpi)}`}
            />
            {view.openDay && facts ? (
              <Kpi
                label="Cash in drawer (expected)"
                value={rupees(expectedCash(view.openDay, facts))}
                note={`Day open since ${new Date(view.openDay.openedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}`}
              />
            ) : (
              <Kpi label="Net (sales − money out)" value={rupees(view.s.net)} delta={change(view.s.net, view.baseline?.net)} note={view.baselineLabel} />
            )}
          </section>

          <div className="dash-grid">
            <section className="card span-2">
              <h2 className="card-title">{view.single ? "Orders by hour" : "Orders by hour (average per day)"}</h2>
              <ColumnChart
                title="Orders by hour"
                categories={hoursOpen(view.hours.orders, view.typical).map(hourLabel)}
                series={[
                  {
                    name: view.single ? (range === "today" ? "Today" : "Yesterday") : "Average",
                    color: SERIES.blue,
                    values: hoursOpen(view.hours.orders, view.typical).map((h) => view.hours.orders[h] / (view.single ? 1 : Math.max(1, view.cur.days.length))),
                  },
                  ...(view.typical
                    ? [{ name: "Usual for this weekday", color: SERIES.gray, values: hoursOpen(view.hours.orders, view.typical).map((h) => view.typical![h]) }]
                    : []),
                ]}
                format={(n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))}
              />
            </section>
            <section className="card">
              <h2 className="card-title">Needs your attention</h2>
              <Attention view={view} />
            </section>

            <section className="card span-2">
              <h2 className="card-title">Sales by day</h2>
              {view.days.length > 1 ? (
                <ColumnChart
                  title="Sales by day"
                  categories={view.days.map((d) => d.date.slice(5).split("-").reverse().join("/"))}
                  series={[{ name: "Sales", color: SERIES.blue, values: view.days.map((d) => d.sales) }]}
                  format={rupees}
                  axisFormat={compactRupees}
                />
              ) : (
                <p className="muted">Pick a longer range to see day-by-day sales.</p>
              )}
            </section>
            <section className="card stack">
              <h2 className="card-title">Payment mix</h2>
              <ShareBar
                format={rupees}
                parts={[
                  { name: "Cash", value: view.s.cash, color: SERIES.orange },
                  { name: "UPI", value: view.s.upi, color: SERIES.aqua },
                ]}
              />
              <h2 className="card-title" style={{ marginTop: 12 }}>
                Order type
              </h2>
              {view.channels.map((c) => (
                <div key={c.channel} className="list-row small">
                  <span style={{ textTransform: "capitalize" }}>{c.channel}</span>
                  <span>
                    <strong>{rupees(c.sales)}</strong> <span className="muted">· {c.orders} orders</span>
                  </span>
                </div>
              ))}
            </section>

            <section className="card span-2">
              <h2 className="card-title">Items: what sells and what earns</h2>
              <ItemsTable items={view.items} />
            </section>
            <section className="card">
              <h2 className="card-title">Money out by category</h2>
              {view.expenses.length === 0 ? <p className="muted">No expenses recorded.</p> : null}
              <BarList
                format={rupees}
                rows={view.expenses.map((e) => {
                  const prev = view.prevExpenses?.find((p) => p.category === e.category)?.amount;
                  const d = change(e.amount, prev);
                  return {
                    label: CATEGORY_LABEL[e.category] ?? e.category,
                    value: e.amount,
                    note: d != null && Math.abs(d) >= 0.1 ? `${d > 0 ? "▲" : "▼"} ${pct(Math.abs(d))} vs previous ${len} days` : undefined,
                  };
                })}
              />
            </section>

            <section className="card span-2">
              <h2 className="card-title">Leakage by staff</h2>
              <StaffTable rows={view.staff} />
            </section>
            <section className="card">
              <h2 className="card-title">Days</h2>
              <DaysList days={view.days} />
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function computeView(facts: Facts, from: string, to: string, len: number, menu: AdminMenu | null, untilMinutes?: number) {
  const cur = inRange(facts, from, to);
  // The upsell to watch: drinks if the menu has them, otherwise snacks (spring rolls, fries).
  const addOnCategory = menu ? (["Drinks", "Snacks"].find((n) => menu.categories.some((c) => c.name.toLowerCase() === n.toLowerCase())) ?? null) : null;
  const single = len === 1;
  const baseline: Summary | null = single
    ? typicalSummary(facts, from, 4, untilMinutes)
    : summarize(inRange(facts, addDays(from, -len), addDays(from, -1)));
  const prevFacts = single ? null : inRange(facts, addDays(from, -len), addDays(from, -1));
  return {
    cur,
    single,
    s: summarize(cur),
    baseline,
    baselineLabel: single ? `vs a usual ${new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" }).format(new Date(`${from}T00:00:00Z`))}${untilMinutes != null ? " by this time" : ""}` : `vs previous ${len} days`,
    hours: byHour(cur.orders),
    typical: single ? typicalByHour(facts, from) : null,
    days: dayRows(cur),
    items: itemPerformance(cur.orders, menu),
    staff: staffLeakage(cur),
    expenses: expensesByCategory(cur.expenses),
    prevExpenses: prevFacts ? expensesByCategory(prevFacts.expenses) : null,
    channels: channelMix(cur.orders),
    stockOuts: stockOutCounts(cur, menu),
    addOnCategory,
    drinkRate: menu && addOnCategory ? attachRate(cur.orders, menu, addOnCategory) : null,
    prevDrinkRate: menu && prevFacts && addOnCategory ? attachRate(prevFacts.orders, menu, addOnCategory) : null,
    openDay: cur.days.find((d) => d.closedAt == null) ?? null,
  };
}

type View = ReturnType<typeof computeView>;

/** Hours worth showing: from the first to the last hour with any orders (typical included). */
function hoursOpen(orders: number[], typical: number[] | null): number[] {
  const any = (h: number) => orders[h] > 0 || (typical?.[h] ?? 0) > 0;
  let a = 0;
  let b = 23;
  while (a < 23 && !any(a)) a++;
  while (b > a && !any(b)) b--;
  if (!any(a)) return Array.from({ length: 12 }, (_, i) => 11 + i);
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

function Kpi({
  label,
  value,
  delta,
  note,
  upIsGood = true,
}: {
  label: string;
  value: string;
  delta?: number | null;
  note?: string;
  upIsGood?: boolean;
}) {
  const good = delta == null ? null : delta >= 0 === upIsGood;
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {delta != null ? (
        <span className="kpi-delta" style={{ color: good ? "#006300" : "#b91c1c" }}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(0)}% <span className="muted">{note}</span>
        </span>
      ) : note ? (
        <span className="kpi-delta muted">{note}</span>
      ) : null}
    </div>
  );
}

/** Plain-language flags, each computed from the numbers above (no guesses). */
function Attention({ view }: { view: View }) {
  const notes: { title: string; body: string }[] = [];
  const s = view.s;

  const totalBills = view.staff.reduce((a, r) => a + r.orders + r.voids, 0);
  const totalVoids = view.staff.reduce((a, r) => a + r.voids, 0);
  for (const r of view.staff) {
    const othersBills = totalBills - r.orders - r.voids;
    const othersRate = othersBills > 0 ? (totalVoids - r.voids) / othersBills : 0;
    if (r.voids >= 3 && r.voidRate > Math.max(0.03, othersRate * 2)) {
      notes.push({
        title: `${r.staff} voided ${pct(r.voidRate, 1)} of bills`,
        body: `${r.voids} voids worth ${rupees(r.voided)}. Others: ${pct(othersRate, 1)}. Check the reasons in Orders.`,
      });
    }
  }
  const short = view.days.filter((d) => (d.variance ?? 0) < 0);
  if (short.length) {
    notes.push({
      title: `Cash short on ${short.length} day${short.length === 1 ? "" : "s"}`,
      body: `Total ${rupees(-short.reduce((a, d) => a + (d.variance ?? 0), 0))} short at day close.`,
    });
  }
  if (view.drinkRate != null) {
    const d = view.prevDrinkRate != null ? view.drinkRate - view.prevDrinkRate : null;
    notes.push({
      title: `${view.addOnCategory} add-on rate ${pct(view.drinkRate)}`,
      body:
        d != null && Math.abs(d) >= 0.01
          ? `${d < 0 ? "Down" : "Up"} from ${pct(view.prevDrinkRate)} in the previous period. Offering one with every momo order can lift it.`
          : `Share of orders that include something from ${view.addOnCategory}.`,
    });
  }
  for (const so of view.stockOuts.slice(0, 2)) {
    notes.push({ title: `${so.name} sold out ${so.times} time${so.times === 1 ? "" : "s"}`, body: `Usually around ${so.typicalTime}. Prepare more before then.` });
  }
  const rising = view.expenses
    .map((e) => ({ e, prev: view.prevExpenses?.find((p) => p.category === e.category)?.amount }))
    .find(({ e, prev }) => prev && e.amount > prev * 1.2 && e.amount - prev > 100000);
  if (rising) {
    notes.push({
      title: `${CATEGORY_LABEL[rising.e.category] ?? rising.e.category} spend up ${pct(change(rising.e.amount, rising.prev))}`,
      body: `${rupees(rising.e.amount)} vs ${rupees(rising.prev!)} in the previous period, while sales changed less.`,
    });
  }
  const noCost = view.items.filter((i) => i.margin == null).length;
  if (noCost) notes.push({ title: `${noCost} item${noCost === 1 ? " has" : "s have"} no cost`, body: "Add costs in Menu & prices to see their margin." });
  if (s.orders === 0) return <p className="muted">Nothing yet for this period.</p>;
  if (!notes.length) return <p className="muted">Nothing unusual in this period.</p>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {notes.map((n) => (
        <div key={n.title} className="attention">
          <strong>{n.title}</strong>
          <span className="small">{n.body}</span>
        </div>
      ))}
    </div>
  );
}

function ItemsTable({ items }: { items: ReturnType<typeof itemPerformance> }) {
  const [all, setAll] = useState(false);
  const [sort, setSort] = useState<"revenue" | "margin" | "qty">("revenue");
  const sorted = [...items].sort((a, b) =>
    sort === "revenue" ? b.revenue - a.revenue : sort === "qty" ? b.qty - a.qty : (b.margin ?? -Infinity) - (a.margin ?? -Infinity),
  );
  const shown = all ? sorted : sorted.slice(0, 10);
  const max = Math.max(1, ...items.map((i) => i.revenue));
  if (!items.length) return <p className="muted">No sales in this period.</p>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row small" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className="muted">Sort by</span>
        {(["revenue", "margin", "qty"] as const).map((k) => (
          <button key={k} type="button" className="chip" style={{ minHeight: 36 }} aria-pressed={sort === k} onClick={() => setSort(k)}>
            {k === "revenue" ? "Sales" : k === "margin" ? "Margin" : "Quantity"}
          </button>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="num">
                Qty
              </th>
              <th scope="col" style={{ width: "30%" }}>
                Sales
              </th>
              <th scope="col" className="num">
                Margin
              </th>
              <th scope="col" className="num">
                Margin %
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.refId}>
                <td>{i.name}</td>
                <td className="num">{i.qty}</td>
                <td>
                  <span className="inline-bar">
                    <span style={{ width: `${(i.revenue / max) * 100}%`, background: SERIES.blue }} />
                    <span className="num">{rupees(i.revenue)}</span>
                  </span>
                </td>
                <td className="num">{i.margin == null ? <span className="tag-warn">No cost</span> : rupees(i.margin)}</td>
                <td className="num">{pct(i.marginPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > 10 ? (
        <button type="button" className="btn" onClick={() => setAll((a) => !a)}>
          {all ? "Show top 10" : `Show all ${items.length}`}
        </button>
      ) : null}
    </div>
  );
}

function StaffTable({ rows }: { rows: ReturnType<typeof staffLeakage> }) {
  if (!rows.length) return <p className="muted">No bills in this period.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Staff</th>
            <th scope="col" className="num">
              Bills
            </th>
            <th scope="col" className="num">
              Sales
            </th>
            <th scope="col" className="num">
              Voids
            </th>
            <th scope="col" className="num">
              Voided ₹
            </th>
            <th scope="col" className="num">
              Discounts
            </th>
            <th scope="col" className="num">
              Cash short
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.staff}>
              <td>{r.staff}</td>
              <td className="num">{r.orders}</td>
              <td className="num">{rupees(r.sales)}</td>
              <td className="num">
                {r.voids} <span className="muted">({pct(r.voidRate, 1)})</span>
              </td>
              <td className="num">{rupees(r.voided)}</td>
              <td className="num">
                {r.discounts} <span className="muted">({rupees(r.discounted)})</span>
              </td>
              <td className="num">{r.cashShort < 0 ? `${rupees(-r.cashShort)} on ${r.shortDays} day${r.shortDays === 1 ? "" : "s"}` : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted" style={{ margin: "8px 0 0" }}>
        Cash short is counted against whoever took most of that day&apos;s bills.
      </p>
    </div>
  );
}

function DaysList({ days }: { days: ReturnType<typeof dayRows> }) {
  if (!days.length) return <p className="muted">No days in this period.</p>;
  return (
    <div style={{ maxHeight: 360, overflow: "auto" }}>
      {[...days].reverse().map((d) => (
        <div key={d.date} className="list-row small">
          <span className="stack" style={{ gap: 2 }}>
            <strong>{d.date}</strong>
            <span className="muted">
              {d.orders} bills · out {rupees(d.moneyOut)}
            </span>
          </span>
          <span className="stack" style={{ gap: 2, textAlign: "right" }}>
            <strong>{rupees(d.sales)}</strong>
            <span style={{ color: d.open ? "var(--muted)" : (d.variance ?? 0) < 0 ? "#b91c1c" : "var(--muted)" }}>
              {d.open ? "open" : d.variance ? `${d.variance < 0 ? "short" : "extra"} ${rupees(Math.abs(d.variance))}` : "cash matched"}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
