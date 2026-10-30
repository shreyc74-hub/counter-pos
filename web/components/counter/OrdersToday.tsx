"use client";

import { useMemo, useState } from "react";
import { formatRupees } from "@/lib/domain/money";
import { isUnpaid } from "@/lib/domain/billing";
import type { Order, Outlet, PaymentMethod, Staff } from "@/lib/domain/types";
import { layoutReceipt } from "@/lib/print/receipt";
import { PinPad, ReceiptPreview, Sheet, errorText, usePrinter } from "./ui";

const VOID_REASONS = ["Customer changed mind", "Wrong item entered", "Duplicate bill", "Payment failed", "Other"];

export function OrdersToday({
  orders,
  outlet,
  staff,
  onVoid,
  onReprint,
  onSettle,
  unpaidOnly = false,
}: {
  orders: Order[];
  /** "Unpaid orders": only dine-in bills still waiting for payment. */
  unpaidOnly?: boolean;
  outlet: Outlet;
  staff: Staff;
  onVoid: (orderId: string, reason: string, approverPin: string | null) => Promise<void>;
  onReprint: (order: Order) => void;
  /** Takes payment for a "Not paid" dine-in bill. */
  onSettle: (order: Order, method: PaymentMethod) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Order | null>(null);
  const shown = useMemo(() => (unpaidOnly ? orders.filter(isUnpaid) : orders), [orders, unpaidOnly]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shown;
    return shown.filter((o) => o.billNo.toLowerCase().includes(q) || String(o.token) === q);
  }, [shown, query]);
  const waiting = shown.reduce((s, o) => s + o.totalPaise, 0);
  return (
    <div className="page">
      <div className="page-narrow stack">
        <div className="row between" style={{ flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26 }}>{unpaidOnly ? "Unpaid orders" : "Orders today"}</h1>
          <input
            className="input"
            style={{ maxWidth: 280, minHeight: 44 }}
            placeholder="Search bill no. or token"
            aria-label="Search bill number or token"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="card" style={{ padding: "4px 20px" }}>
          {unpaidOnly && shown.length ? (
            <p className="small muted">
              {shown.length} bill{shown.length === 1 ? "" : "s"} waiting for payment: {formatRupees(waiting)}. Tap one to review it and mark it paid; it keeps
              its bill number.
            </p>
          ) : null}
          {filtered.length === 0 ? <p className="muted">{unpaidOnly ? "Nothing waiting for payment." : "No orders yet."}</p> : null}
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              className="list-row"
              style={{ width: "100%", border: "none", borderBottom: "1px solid #efebe3", background: "none", textAlign: "left" }}
              onClick={() => setOpen(o)}
            >
              <span className="stack" style={{ gap: 2 }}>
                <strong>
                  Token {o.token} · {o.billNo} {o.voided ? <span className="void-tag">VOID</span> : null}
                  {isUnpaid(o) ? <span className="void-tag unpaid-tag">NOT PAID</span> : null}
                </strong>
                <span className="small muted">
                  {new Date(o.createdAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })} ·{" "}
                  {o.payments.length ? o.payments.map((p) => (p.method === "cash" ? "Cash" : "UPI")).join(" + ") : "Not paid"} · {o.staffName}
                  {o.channel !== "counter" ? ` · ${o.channel}` : ""}
                  {o.service ? ` · ${o.service === "dine_in" ? "Dine in" : "Takeaway"}` : ""}
                </span>
              </span>
              <strong style={o.voided ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>
                {formatRupees(o.totalPaise)}
              </strong>
            </button>
          ))}
        </div>
      </div>
      {open ? (
        <OrderDetail
          order={orders.find((o) => o.id === open.id) ?? open}
          outlet={outlet}
          staff={staff}
          onClose={() => setOpen(null)}
          onVoid={onVoid}
          onReprint={onReprint}
          onSettle={async (o, m) => {
            await onSettle(o, m);
            setOpen(null); // paid: back to the list (the toast confirms it)
          }}
        />
      ) : null}
    </div>
  );
}

function OrderDetail({
  order,
  outlet,
  staff,
  onClose,
  onVoid,
  onReprint,
  onSettle,
}: {
  order: Order;
  outlet: Outlet;
  staff: Staff;
  onClose: () => void;
  onSettle: (order: Order, method: PaymentMethod) => Promise<void>;
  onVoid: (orderId: string, reason: string, approverPin: string | null) => Promise<void>;
  onReprint: (order: Order) => void;
}) {
  const svc = usePrinter();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [needPin, setNeedPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const width = svc.getSettings().width;
  const settle = async (method: PaymentMethod) => {
    setError(null);
    setSettling(true);
    try {
      await onSettle(order, method);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSettling(false);
    }
  };

  const doVoid = async (pin: string | null) => {
    setError(null);
    try {
      await onVoid(order.id, reason, pin);
      setVoiding(false);
      setNeedPin(false);
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (needPin) {
    return (
      <Sheet title="Owner PIN to void" onClose={onClose}>
        <p className="muted">Cashiers need the owner&apos;s PIN to void a bill.</p>
        <div style={{ maxWidth: 380, margin: "0 auto", width: "100%" }}>
          <PinPad light error={error} onSubmit={(pin) => doVoid(pin)} />
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={`Token ${order.token} · ${order.billNo}`} onClose={onClose}>
      {order.voided ? (
        <div className="error small">
          Voided by {order.voided.by}
          {order.voided.approvedBy ? ` (approved by ${order.voided.approvedBy})` : ""}: {order.voided.reason}
        </div>
      ) : null}
      {isUnpaid(order) && !voiding ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="notice">
            <strong>Not paid yet: {formatRupees(order.totalPaise)}.</strong> Take the payment when the customer pays.
          </div>
          {error ? <div className="error small">{error}</div> : null}
          <div className="pay">
            <button type="button" className="btn btn-cash" disabled={settling} onClick={() => void settle("cash")}>
              Paid CASH
            </button>
            <button type="button" className="btn btn-upi" disabled={settling} onClick={() => void settle("upi")}>
              Paid UPI
            </button>
          </div>
        </div>
      ) : null}
      <div style={{ maxHeight: "40dvh", overflow: "auto" }}>
        <ReceiptPreview lines={layoutReceipt(order, outlet, { width, itemSize: svc.getSettings().itemSize })} width={width} />
      </div>
      {voiding ? (
        <div className="stack">
          <span className="field">Why is this bill being voided?</span>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {VOID_REASONS.map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
          {error ? <div className="error small">{error}</div> : null}
          <div className="row">
            <button type="button" className="btn btn-big grow" onClick={() => setVoiding(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger btn-big grow"
              disabled={!reason}
              onClick={() => (staff.role === "owner" ? void doVoid(null) : setNeedPin(true))}
            >
              Void bill
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="btn btn-big grow" disabled={svc.getSettings().mode === "none"} onClick={() => onReprint(order)}>
            Reprint (duplicate)
          </button>
          {!order.voided ? (
            <button type="button" className="btn btn-big grow" style={{ color: "var(--bad)" }} onClick={() => setVoiding(true)}>
              Void…
            </button>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
