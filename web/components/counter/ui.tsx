"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { printer } from "@/lib/print/printer";
import { type ReceiptLine, renderText } from "@/lib/print/receipt";

export function Sheet({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`sheet${wide ? " sheet-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="row between">
          <h2 style={{ fontSize: 22 }}>{title}</h2>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Number pad used for staff PINs and owner approvals. */
export function PinPad({
  length = 4,
  onSubmit,
  light,
  error,
}: {
  length?: number;
  onSubmit: (pin: string) => void | Promise<void>;
  light?: boolean;
  error?: string | null;
}) {
  const [pin, setPin] = useState("");
  const press = async (k: string) => {
    if (k === "clear") return setPin("");
    if (k === "ok") {
      if (pin.length === length) {
        const p = pin;
        setPin("");
        await onSubmit(p);
      }
      return;
    }
    const next = (pin + k).slice(0, length);
    setPin(next);
    if (next.length === length) {
      setPin("");
      await onSubmit(next);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) void press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter") void press("ok");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "ok"];
  return (
    <div className={`stack${light ? " keypad-light" : ""}`} style={{ gap: 20 }}>
      <div className="pin-dots" aria-label={`${pin.length} of ${length} digits entered`}>
        {Array.from({ length }, (_, i) => (
          <span key={i} className={`pin-dot${i < pin.length ? " on" : ""}`} />
        ))}
      </div>
      {error ? (
        <div role="alert" style={{ textAlign: "center", color: light ? "#b91c1c" : "#fca5a5", fontWeight: 600 }}>
          {error}
        </div>
      ) : null}
      <div className="keypad">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            className={`key${k === "ok" ? " key-ok" : ""}`}
            style={k === "clear" ? { fontSize: 18 } : undefined}
            aria-label={k === "ok" ? "Enter" : k === "clear" ? "Clear" : k}
            onClick={() => void press(k)}
          >
            {k === "ok" ? "OK" : k === "clear" ? "Clear" : k}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Receipt preview built from the same lines that are printed. */
export function ReceiptPreview({ lines, width }: { lines: ReceiptLine[]; width: number }) {
  return (
    <div className="receipt" aria-label="Receipt preview">
      {lines.map((l, i) => {
        const text = renderText([l], width);
        if (l.kind === "text") {
          const cls = [l.big ? "big" : l.bold ? "bold" : "", l.tall ? "tall" : ""].filter(Boolean).join(" ") || undefined;
          if (l.boldChars && !l.bold && !l.big && (l.align ?? "left") === "left") {
            return (
              <div key={i} className={cls}>
                <span>
                  <strong>{text.slice(0, l.boldChars)}</strong>
                  {text.slice(l.boldChars)}
                </span>
              </div>
            );
          }
          return (
            <div key={i} className={cls}>
              {l.tall ? <span>{text || " "}</span> : text || " "}
            </div>
          );
        }
        return <div key={i}>{text || " "}</div>;
      })}
    </div>
  );
}

export function usePrinter() {
  const svc = printer();
  useSyncExternalStore(
    (fn) => svc.subscribe(fn),
    () => svc.getVersion(),
    () => 0,
  );
  return svc;
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}

export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong. Try again.";
}
