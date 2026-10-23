"use client";

import { useState } from "react";
import { formatRupees, rupeesToPaise } from "@/lib/domain/money";
import type { CashMovement, DayTotals, Expense, ExpenseCategory, PaymentMethod } from "@/lib/domain/types";
import { errorText } from "./ui";

const CATEGORIES: { id: ExpenseCategory; label: string }[] = [
  { id: "ingredients", label: "Ingredients" },
  { id: "packaging", label: "Packaging" },
  { id: "gas", label: "Gas" },
  { id: "rent", label: "Rent" },
  { id: "salary", label: "Salary" },
  { id: "electricity", label: "Electricity" },
  { id: "maintenance", label: "Maintenance" },
  { id: "other", label: "Other" },
];

type Mode = "expense" | "out" | "in";

export function ExpenseScreen({
  totals,
  expenses,
  movements,
  onAddExpense,
  onAddMovement,
  notify,
}: {
  totals: DayTotals;
  expenses: Expense[];
  movements: CashMovement[];
  onAddExpense: (e: { category: ExpenseCategory; amountPaise: number; method: PaymentMethod; note: string | null }) => Promise<void>;
  onAddMovement: (m: { direction: "in" | "out"; amountPaise: number; reason: string }) => Promise<void>;
  notify: (msg: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("expense");
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [amountText, setAmountText] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const amount = rupeesToPaise(amountText) ?? 0;
  const valid = amount > 0 && (mode !== "expense" || !!category) && (mode === "expense" || note.trim().length > 0);

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === "expense" && category) {
        await onAddExpense({ category, amountPaise: amount, method, note: note.trim() || null });
        notify(`Expense saved: ${formatRupees(amount)}`);
      } else {
        await onAddMovement({ direction: mode === "in" ? "in" : "out", amountPaise: amount, reason: note.trim() });
        notify(`Cash ${mode === "in" ? "in" : "out"} saved: ${formatRupees(amount)}`);
      }
      setAmountText("");
      setNote("");
      setCategory(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const outRows = [
    ...expenses.map((e) => ({
      id: e.id,
      at: e.createdAt,
      what: `${CATEGORIES.find((c) => c.id === e.category)?.label ?? e.category}${e.note ? ` · ${e.note}` : ""}`,
      meta: `${e.method === "cash" ? "Cash" : "UPI"} · ${e.staffName}`,
      amt: -e.amountPaise,
    })),
    ...movements.map((m) => ({
      id: m.id,
      at: m.createdAt,
      what: `Cash ${m.direction === "in" ? "put in" : "taken out"} · ${m.reason}`,
      meta: m.staffName,
      amt: m.direction === "in" ? m.amountPaise : -m.amountPaise,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="page">
      <div className="page-narrow two-col">
        <section className="card stack" style={{ gap: 18 }}>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {(
              [
                ["expense", "Expense"],
                ["out", "Cash out of drawer"],
                ["in", "Cash into drawer"],
              ] as [Mode, string][]
            ).map(([m, label]) => (
              <button key={m} type="button" className="chip" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {label}
              </button>
            ))}
          </div>
          {mode === "expense" ? (
            <div className="stack" style={{ gap: 8 }}>
              <span className="field">Category</span>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {CATEGORIES.map((c) => (
                  <button key={c.id} type="button" className="chip" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <label className="field">
            Amount (₹)
            <input className="input input-big" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          </label>
          {mode === "expense" ? (
            <div className="stack" style={{ gap: 8 }}>
              <span className="field">Paid by</span>
              <div className="row">
                <button type="button" className={`btn btn-big grow${method === "cash" ? " btn-cash" : ""}`} aria-pressed={method === "cash"} onClick={() => setMethod("cash")}>
                  Cash
                </button>
                <button type="button" className={`btn btn-big grow${method === "upi" ? " btn-upi" : ""}`} aria-pressed={method === "upi"} onClick={() => setMethod("upi")}>
                  UPI
                </button>
              </div>
            </div>
          ) : null}
          <label className="field">
            {mode === "expense" ? "Note (optional)" : "Reason (required)"}
            <input
              className="input"
              value={note}
              placeholder={mode === "expense" ? "e.g. Momo boxes, 200 pcs" : mode === "out" ? "e.g. Paid vegetable supplier" : "e.g. Change top-up"}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {error ? <div className="error small">{error}</div> : null}
          <button type="button" className="btn btn-dark btn-big" disabled={!valid || saving} onClick={() => void save()}>
            {saving ? "Saving…" : mode === "expense" ? "Save expense" : "Save"}
          </button>
        </section>

        <section className="stack">
          <div className="card stack">
            <strong>Today so far</strong>
            <div className="kv">
              <div>
                <span className="small muted">Money in</span>
                <span className="v">{formatRupees(totals.salesPaise + totals.cashInPaise)}</span>
              </div>
              <div>
                <span className="small muted">Money out</span>
                <span className="v" style={{ color: "var(--cash-dark)" }}>
                  {formatRupees(totals.expenseCashPaise + totals.expenseUpiPaise + totals.cashOutPaise)}
                </span>
              </div>
              <div>
                <span className="small muted">Cash in drawer (expected)</span>
                <span className="v">{formatRupees(totals.expectedCashPaise)}</span>
              </div>
            </div>
          </div>
          <div className="card" style={{ padding: "8px 20px" }}>
            <strong style={{ display: "block", padding: "8px 0" }}>Today&apos;s money out and cash movements</strong>
            {outRows.length === 0 ? <p className="muted">Nothing yet.</p> : null}
            {outRows.map((r) => (
              <div key={r.id} className="list-row">
                <span className="stack" style={{ gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>{r.what}</span>
                  <span className="small muted">
                    {new Date(r.at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })} · {r.meta}
                  </span>
                </span>
                <strong>{r.amt > 0 ? "+" : ""}{formatRupees(r.amt)}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
