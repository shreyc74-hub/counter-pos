"use client";

import { useState } from "react";
import { formatRupees, rupeesToPaise } from "@/lib/domain/money";
import type { DaySession, DayTotals, Menu, Staff } from "@/lib/domain/types";
import { errorText } from "./ui";

export function OpenDayScreen({
  staff,
  onOpen,
  onLock,
}: {
  staff: Staff;
  onOpen: (floatPaise: number) => Promise<void>;
  onLock: () => void;
}) {
  const [text, setText] = useState("1000");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const amount = rupeesToPaise(text);
  return (
    <main className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}>
      <div className="card stack" style={{ width: "min(520px, 100%)", gap: 18 }}>
        <h1 style={{ fontSize: 26 }}>Open the day</h1>
        <p className="muted" style={{ margin: 0 }}>
          Hi {staff.name}. Count the cash in the drawer before the first order.
        </p>
        <label className="field">
          Opening cash (float) ₹
          <input className="input input-big" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        {error ? <div className="error small">{error}</div> : null}
        <button
          type="button"
          className="btn btn-cash btn-big"
          disabled={amount == null || saving}
          onClick={async () => {
            if (amount == null) return;
            setSaving(true);
            setError(null);
            try {
              await onOpen(amount);
            } catch (e) {
              setError(errorText(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          Open day with {amount != null ? formatRupees(amount) : "…"}
        </button>
        <button type="button" className="btn" onClick={onLock}>
          Lock
        </button>
      </div>
    </main>
  );
}

export function CloseDayScreen({
  day,
  totals,
  menu,
  onClose,
  onPrintReport,
}: {
  day: DaySession;
  totals: DayTotals;
  menu: Menu;
  onClose: (countedPaise: number, leftovers: { variantId: string; plates: number }[]) => Promise<void>;
  onPrintReport: () => void;
}) {
  const [countedText, setCountedText] = useState("");
  const [leftovers, setLeftovers] = useState<Record<string, number>>({});
  const [skipLeftovers, setSkipLeftovers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const counted = rupeesToPaise(countedText);
  const variance = counted != null ? counted - totals.expectedCashPaise : null;

  const batchVariants = menu.variants
    .filter((v) => v.active && menu.items.find((i) => i.id === v.itemId)?.batchCooked)
    .map((v) => ({ v, item: menu.items.find((i) => i.id === v.itemId)! }));

  const rows: [string, number][] = [
    ["Opening float", day.openingFloatPaise],
    ["+ Cash sales", totals.cashSalesPaise],
    ["+ Cash put in", totals.cashInPaise],
    ["− Cash expenses", totals.expenseCashPaise],
    ["− Cash taken out", totals.cashOutPaise],
  ];

  return (
    <div className="page">
      <div className="page-narrow stack" style={{ gap: 18 }}>
        <div className="row between" style={{ flexWrap: "wrap" }}>
          <div className="stack" style={{ gap: 4 }}>
            <h1 style={{ fontSize: 26 }}>Close day · {day.businessDate}</h1>
            <span className="muted">
              Opened by {day.openedBy} · {totals.orders} orders · Sales {formatRupees(totals.salesPaise)} (Cash{" "}
              {formatRupees(totals.cashSalesPaise)} · UPI {formatRupees(totals.upiSalesPaise)})
            </span>
          </div>
          <button type="button" className="btn" onClick={onPrintReport}>
            Print day report so far
          </button>
        </div>
        {totals.unpaidCount ? (
          <div className="error">
            {totals.unpaidCount} dine-in bill{totals.unpaidCount === 1 ? " is" : "s are"} not paid yet ({formatRupees(totals.unpaidPaise)}). Take the
            payment in ☰ → Unpaid orders (or void the bill) before closing the day.
          </div>
        ) : null}
        <div className="two-col">
          <section className="card stack">
            <strong style={{ fontSize: 18 }}>Cash check</strong>
            {rows.map(([k, v]) => (
              <div key={k} className="list-row">
                <span>{k}</span>
                <strong>{formatRupees(v)}</strong>
              </div>
            ))}
            <div className="total" style={{ padding: "12px 16px", background: "var(--ground)", borderRadius: 12 }}>
              <span style={{ fontWeight: 700 }}>Expected cash in drawer</span>
              <strong style={{ fontSize: 28 }}>{formatRupees(totals.expectedCashPaise)}</strong>
            </div>
            <label className="field">
              Counted cash ₹
              <input className="input input-big" inputMode="decimal" value={countedText} onChange={(e) => setCountedText(e.target.value)} />
            </label>
            {variance != null ? (
              <div className={variance === 0 ? "notice" : "notice"} style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                <span>Difference</span>
                <span style={{ color: variance < 0 ? "var(--bad)" : variance > 0 ? "var(--ok)" : "inherit" }}>
                  {variance === 0 ? "Matches" : variance < 0 ? `${formatRupees(-variance)} short` : `${formatRupees(variance)} extra`}
                </span>
              </div>
            ) : null}
            <span className="small muted">UPI today: {formatRupees(totals.upiSalesPaise)} as marked by staff. Check it against your UPI app.</span>
          </section>
          <section className="card stack">
            <div className="row between">
              <strong style={{ fontSize: 18 }}>Leftover plates (optional)</strong>
              <button type="button" className="btn" aria-pressed={skipLeftovers} onClick={() => setSkipLeftovers((s) => !s)}>
                {skipLeftovers ? "Count leftovers" : "Skip"}
              </button>
            </div>
            {skipLeftovers ? (
              <p className="muted">Skipped. Nothing breaks: prep forecasts use sales data.</p>
            ) : (
              <>
                <span className="small muted">Only batch-cooked momos. Helps show money saved by better prep.</span>
                {batchVariants.map(({ v, item }) => (
                  <div key={v.id} className="list-row">
                    <span style={{ fontWeight: 600 }}>
                      {item.name} · {v.name}
                    </span>
                    <span className="qty">
                      <button
                        type="button"
                        aria-label={`Fewer ${item.name} ${v.name}`}
                        onClick={() => setLeftovers((l) => ({ ...l, [v.id]: Math.max(0, (l[v.id] ?? 0) - 1) }))}
                      >
                        −
                      </button>
                      <strong style={{ minWidth: 24, textAlign: "center" }}>{leftovers[v.id] ?? 0}</strong>
                      <button
                        type="button"
                        aria-label={`More ${item.name} ${v.name}`}
                        onClick={() => setLeftovers((l) => ({ ...l, [v.id]: (l[v.id] ?? 0) + 1 }))}
                      >
                        +
                      </button>
                    </span>
                  </div>
                ))}
              </>
            )}
          </section>
        </div>
        {error ? <div className="error">{error}</div> : null}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn btn-cash btn-big"
            disabled={counted == null || saving}
            onClick={async () => {
              if (counted == null) return;
              setSaving(true);
              setError(null);
              try {
                await onClose(
                  counted,
                  skipLeftovers ? [] : Object.entries(leftovers).map(([variantId, plates]) => ({ variantId, plates })),
                );
              } catch (e) {
                setError(errorText(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Closing…" : "Close day"}
          </button>
        </div>
      </div>
    </div>
  );
}
