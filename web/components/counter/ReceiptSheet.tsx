"use client";

import { useEffect } from "react";
import { formatRupees } from "@/lib/domain/money";
import type { Order, Outlet } from "@/lib/domain/types";
import { layoutReceipt } from "@/lib/print/receipt";
import { ReceiptPreview, usePrinter } from "./ui";

/** Shown right after a bill is saved: the receipt plus its print status. */
export function ReceiptSheet({
  order,
  outlet,
  jobId,
  onNewOrder,
  onPrint,
  onOpenPrinter,
}: {
  order: Order;
  outlet: Outlet;
  jobId: string | null;
  onNewOrder: () => void;
  onPrint: () => void;
  onOpenPrinter: () => void;
}) {
  const svc = usePrinter();
  const settings = svc.getSettings();
  const job = svc.job(jobId);
  const lines = layoutReceipt(order, outlet, { width: settings.width, itemSize: settings.itemSize });

  // Go back to a fresh order on its own once the receipt has printed (or there is no printer).
  useEffect(() => {
    const finished = !job || job.status === "done";
    if (!finished) return;
    const t = setTimeout(onNewOrder, settings.mode === "none" ? 4000 : 2500);
    return () => clearTimeout(t);
  }, [job, onNewOrder, settings.mode]);

  return (
    <div className="backdrop">
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Bill saved">
        <div className="row between">
          <div className="stack" style={{ gap: 4 }}>
            <h2 style={{ fontSize: 24 }}>
              Saved · Token {order.token} · {formatRupees(order.totalPaise)}
            </h2>
            <span className="muted small">
              {order.billNo} ·{" "}
              {order.payments.length
                ? order.payments.map((p) => `${p.method === "cash" ? "Cash" : "UPI"} ${formatRupees(p.amountPaise)}`).join(" + ")
                : "NOT PAID: take payment from ☰ → Unpaid orders"}
            </span>
          </div>
        </div>
        <PrintStatus jobId={jobId} onOpenPrinter={onOpenPrinter} />
        <div style={{ maxHeight: "45dvh", overflow: "auto" }}>
          <ReceiptPreview lines={lines} width={settings.width} />
        </div>
        <div className="row">
          <button type="button" className="btn btn-big grow" onClick={onPrint} disabled={settings.mode === "none"}>
            Print again
          </button>
          <button type="button" className="btn btn-dark btn-big grow" onClick={onNewOrder} autoFocus>
            New order
          </button>
        </div>
      </div>
    </div>
  );
}

export function PrintStatus({ jobId, onOpenPrinter }: { jobId: string | null; onOpenPrinter: () => void }) {
  const svc = usePrinter();
  const settings = svc.getSettings();
  const job = svc.job(jobId);
  if (settings.mode === "none") {
    return (
      <div className="notice row between small">
        <span>No printer set up. The bill is saved.</span>
        <button type="button" className="btn" onClick={onOpenPrinter}>
          Set up printer
        </button>
      </div>
    );
  }
  if (!job) return null;
  if (job.status === "failed") {
    return (
      <div className="error row between small" role="alert">
        <span>Print failed: {job.error} The bill is saved.</span>
        <button type="button" className="btn btn-dark" onClick={() => svc.retry(job.id)}>
          Retry
        </button>
      </div>
    );
  }
  const text =
    job.status === "done"
      ? settings.mode === "rawbt"
        ? "Sent to RawBT."
        : settings.mode === "browser"
          ? "Print dialog opened."
          : "Printed."
      : "Printing…";
  return <div className="notice small">{text}</div>;
}
