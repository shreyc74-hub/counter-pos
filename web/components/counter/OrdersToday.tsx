"use client";

import { useMemo, useState } from "react";
import { formatRupees } from "@/lib/domain/money";
import type { Order, Outlet, Staff } from "@/lib/domain/types";
import { layoutReceipt } from "@/lib/print/receipt";
import { PinPad, ReceiptPreview, Sheet, errorText, usePrinter } from "./ui";

const VOID_REASONS = ["Customer changed mind", "Wrong item entered", "Duplicate bill", "Payment failed", "Other"];

export function OrdersToday({
  orders,
  outlet,
  staff,
  onVoid,
  onReprint,
}: {
  orders: Order[];
  outlet: Outlet;
  staff: Staff;
  onVoid: (orderId: string, reason: string, approverPin: string | null) => Promise<void>;
  onReprint: (order: Order) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Order | null>(null);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => o.billNo.toLowerCase().includes(q) || String(o.token) === q);
  }, [orders, query]);
  return (
    <div className="page">
      <div className="page-narrow stack">
        <div className="row between" style={{ flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26 }}>Orders today</h1>
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
          {filtered.length === 0 ? <p className="muted">No orders yet.</p> : null}
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
                </strong>
                <span className="small muted">
                  {new Date(o.createdAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })} ·{" "}
                  {o.payments.map((p) => (p.method === "cash" ? "Cash" : "UPI")).join(" + ")} · {o.staffName}
                  {o.channel !== "counter" ? ` · ${o.channel}` : ""}
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
}: {
  order: Order;
  outlet: Outlet;
  staff: Staff;
  onClose: () => void;
  onVoid: (orderId: string, reason: string, approverPin: string | null) => Promise<void>;
  onReprint: (order: Order) => void;
}) {
  const svc = usePrinter();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [needPin, setNeedPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const width = svc.getSettings().width;

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
      <div style={{ maxHeight: "40dvh", overflow: "auto" }}>
        <ReceiptPreview lines={layoutReceipt(order, outlet, { width })} width={width} />
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
