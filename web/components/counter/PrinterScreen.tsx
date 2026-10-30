"use client";

import { useState } from "react";
import type { Outlet } from "@/lib/domain/types";
import type { PrinterMode } from "@/lib/print/printer";
import { layoutTestPage } from "@/lib/print/receipt";
import { WebBluetoothTransport } from "@/lib/print/transports";
import { PrintStatus } from "./ReceiptSheet";
import { errorText, usePrinter } from "./ui";

const MODES: { id: PrinterMode; title: string; body: string }[] = [
  {
    id: "bluetooth",
    title: "Bluetooth (direct from Chrome)",
    body: "Prints straight from this page. Needs Chrome on Android or a laptop, an https address, and a printer that supports Bluetooth LE.",
  },
  {
    id: "rawbt",
    title: "RawBT app (Android)",
    body: "Install the free RawBT app, pair the printer in RawBT once. Works with almost every cheap Bluetooth printer, including classic-Bluetooth ones.",
  },
  {
    id: "browser",
    title: "Browser print dialog",
    body: "Uses the normal print window. For USB printers on a laptop, or to test the layout on paper/PDF.",
  },
  { id: "none", title: "No printer", body: "Bills are saved and shown on screen only." },
];

export function PrinterScreen({ outlet }: { outlet: Outlet }) {
  const svc = usePrinter();
  const s = svc.getSettings();
  const [error, setError] = useState<string | null>(null);
  const [testJob, setTestJob] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const btSupported = WebBluetoothTransport.isSupported();

  const connect = async () => {
    setError(null);
    setConnecting(true);
    try {
      await svc.connect();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setConnecting(false);
    }
  };

  const failed = svc.getJobs().filter((j) => j.status === "failed");

  return (
    <div className="page">
      <div className="page-narrow two-col">
        <section className="card stack" style={{ gap: 16 }}>
          <h1 style={{ fontSize: 24 }}>Printer</h1>
          <div className="stack" style={{ gap: 10 }}>
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className="option"
                aria-pressed={s.mode === m.id}
                onClick={() => svc.updateSettings({ mode: m.id })}
                style={{ minHeight: 0, padding: "14px 16px" }}
              >
                <strong>{m.title}</strong>
                <span className="small" style={{ opacity: 0.85 }}>
                  {m.body}
                </span>
              </button>
            ))}
          </div>

          {s.mode === "bluetooth" ? (
            <div className="stack">
              {!btSupported ? (
                <div className="error small">
                  This browser can&apos;t use Bluetooth here. Open the app in Chrome over https (or localhost), or use RawBT.
                </div>
              ) : null}
              <div className="row between" style={{ flexWrap: "wrap" }}>
                <span>
                  <span className="dot" style={{ background: svc.isConnected() ? "var(--ok)" : "#a8a194", marginRight: 8 }} />
                  {svc.isConnected() ? `Connected: ${svc.deviceName() ?? "printer"}` : "Not connected"}
                </span>
                <span className="row">
                  {s.bluetoothDeviceId ? (
                    <button type="button" className="btn" onClick={() => void svc.forgetPrinter()}>
                      Forget printer
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-dark" disabled={!btSupported || connecting} onClick={() => void connect()}>
                    {connecting ? "Connecting…" : svc.isConnected() ? "Reconnect" : "Connect printer"}
                  </button>
                </span>
              </div>
              <label className="field">
                Send speed
                <select
                  className="input"
                  value={s.chunkSize}
                  onChange={(e) => svc.updateSettings({ chunkSize: Number(e.target.value) })}
                >
                  <option value={20}>Safe (works with every printer)</option>
                  <option value={100}>Faster</option>
                  <option value={180}>Fastest (if receipts print fully)</option>
                </select>
              </label>
              <p className="small muted" style={{ margin: 0 }}>
                If your printer doesn&apos;t appear in the list, it probably only supports classic Bluetooth: choose RawBT instead.
              </p>
            </div>
          ) : null}

          {s.mode === "rawbt" ? (
            <div className="notice small">
              One-time setup: install RawBT from the Play Store, open it, choose your printer under Settings → Connection, and
              print its test page. After that, receipts from here go to RawBT automatically.
            </div>
          ) : null}

          {s.mode !== "none" ? (
            <>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                <span className="field" style={{ marginRight: 8 }}>
                  Paper
                </span>
                <button type="button" className="chip" aria-pressed={s.width === 32} onClick={() => svc.updateSettings({ width: 32 })}>
                  58 mm (32 characters)
                </button>
                <button type="button" className="chip" aria-pressed={s.width === 48} onClick={() => svc.updateSettings({ width: 48 })}>
                  80 mm (48 characters)
                </button>
              </div>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                <span className="field" style={{ marginRight: 8 }}>
                  Item name size
                </span>
                {(
                  [
                    ["normal", "Normal"],
                    ["medium", "Medium (1¼×)"],
                    ["large", "Large (tall)"],
                  ] as const
                ).map(([v, label]) => (
                  <button key={v} type="button" className="chip" aria-pressed={s.itemSize === v} onClick={() => svc.updateSettings({ itemSize: v })}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="small muted">The test page prints all three sizes so you can compare.</span>
              <label className="row" style={{ gap: 10 }}>
                <input type="checkbox" checked={s.autoPrint} onChange={(e) => svc.updateSettings({ autoPrint: e.target.checked })} style={{ width: 22, height: 22 }} />
                Print automatically when a bill is saved
              </label>
              <label className="row" style={{ gap: 10 }}>
                <input type="checkbox" checked={s.cut} onChange={(e) => svc.updateSettings({ cut: e.target.checked })} style={{ width: 22, height: 22 }} />
                Cut paper after each receipt (only if the printer has a cutter)
              </label>
              {error ? <div className="error small">{error}</div> : null}
              <button
                type="button"
                className="btn btn-cash btn-big"
                onClick={() => setTestJob(svc.enqueue("Test page", layoutTestPage(outlet, { width: s.width })))}
              >
                Print test page
              </button>
              {testJob ? <PrintStatus jobId={testJob} onOpenPrinter={() => undefined} /> : null}
            </>
          ) : null}
        </section>

        <section className="card stack">
          <strong style={{ fontSize: 18 }}>Failed prints</strong>
          {failed.length === 0 ? <p className="muted">None. Every bill is saved even if printing fails.</p> : null}
          {failed.map((j) => (
            <div key={j.id} className="list-row">
              <span className="stack" style={{ gap: 2 }}>
                <strong>{j.label}</strong>
                <span className="small muted">{j.error}</span>
              </span>
              <span className="row">
                <button type="button" className="btn" onClick={() => svc.dismiss(j.id)}>
                  Dismiss
                </button>
                <button type="button" className="btn btn-dark" onClick={() => svc.retry(j.id)}>
                  Retry
                </button>
              </span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
