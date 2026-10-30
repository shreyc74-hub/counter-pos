"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStore } from "@/lib/data";
import { loadPhotos } from "@/lib/data/photos";
import { type Bootstrap, type DeviceChoice, type PosStore, StoreError } from "@/lib/data/store";
import { businessDate, computeDayTotals } from "@/lib/domain/billing";
import { subtotalPaise, totalPaise } from "@/lib/domain/cart";
import { formatRupees } from "@/lib/domain/money";
import type { CashMovement, DaySession, Expense, Order, Payment, Staff } from "@/lib/domain/types";
import { layoutDayReport, layoutReceipt } from "@/lib/print/receipt";
import { uuid } from "@/lib/uuid";
import { CloseDayScreen, OpenDayScreen } from "./DayScreens";
import { ExpenseScreen } from "./ExpenseScreen";
import { LockScreen } from "./LockScreen";
import { type OrderDraft, OrderScreen } from "./OrderScreen";
import { OrdersToday } from "./OrdersToday";
import { PrinterScreen } from "./PrinterScreen";
import { ReceiptSheet } from "./ReceiptSheet";
import { Sheet, Toast, errorText, usePrinter } from "./ui";

type View = "order" | "orders" | "expense" | "day" | "printer";

const IDLE_LOCK_MS = 5 * 60 * 1000;

export function CounterApp() {
  const store = useMemo(() => createStore(), []);
  const svc = usePrinter();
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [bootError, setBootError] = useState<{ message: string; code: string | null } | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [day, setDay] = useState<DaySession | null>(null);
  const [dayLoaded, setDayLoaded] = useState(false);
  const [view, setView] = useState<View>("order");
  const [orders, setOrders] = useState<Order[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [soldOut, setSoldOut] = useState<Set<string>>(new Set());
  const [receipt, setReceipt] = useState<{ order: Order; jobId: string | null } | null>(null);
  const [failedSave, setFailedSave] = useState<{ order: Order; error: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Remounting the order screen empties its cart (used after a retried save succeeds).
  const [cartKey, setCartKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  // Dish photos (cached on this device; only new or changed ones are downloaded).
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const clearToast = useCallback(() => setToast(null), []);

  const loadApp = useCallback(() => {
    setBootError(null);
    store
      .load()
      .then((b) => {
        setBoot(b);
        setSoldOut(new Set(b.soldOut));
      })
      .catch((e) => setBootError({ message: errorText(e), code: e instanceof StoreError ? e.code : null }));
  }, [store]);
  useEffect(loadApp, [loadApp]);

  const refreshDay = useCallback(async () => {
    const d = await store.currentDay();
    setDay(d);
    setDayLoaded(true);
    if (d) {
      const [o, e, m] = await Promise.all([store.listOrders(d.id), store.listExpenses(d.id), store.listCashMovements(d.id)]);
      setOrders(o);
      setExpenses(e);
      setMovements(m);
    } else {
      setOrders([]);
      setExpenses([]);
      setMovements([]);
    }
  }, [store]);

  const lock = useCallback(() => {
    void store.logout();
    setStaff(null);
    setView("order");
    setMenuOpen(false);
  }, [store]);

  useEffect(() => {
    if (!staff) return;
    let cancelled = false;
    loadPhotos(store)
      .then((p) => !cancelled && setPhotos(p))
      .catch(() => undefined); // photos are optional: tiles show names and prices without them
    return () => {
      cancelled = true;
    };
  }, [staff, store]);

  // Devices linked to one person sign straight in with their key: no PIN screen.
  const autoLogin = !!boot?.autoLogin && !!store.autoLogin;
  const [autoLoginFailed, setAutoLoginFailed] = useState(false);
  useEffect(() => {
    if (!boot?.autoLogin || !store.autoLogin || staff) return;
    let cancelled = false;
    store
      .autoLogin()
      .then(async (s) => {
        if (cancelled) return;
        if (!s) return setAutoLoginFailed(true);
        setStaff(s);
        await refreshDay();
      })
      .catch((e) => !cancelled && setBootError({ message: errorText(e), code: e instanceof StoreError ? e.code : null }));
    return () => {
      cancelled = true;
    };
  }, [boot, store, staff, refreshDay]);

  // Lock the counter after a few idle minutes so bills are never saved under the wrong name
  // (only when several people share it with PINs).
  const lastActivity = useRef(Date.now());
  useEffect(() => {
    if (!staff || autoLogin) return;
    const bump = () => (lastActivity.current = Date.now());
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    const t = setInterval(() => {
      if (Date.now() - lastActivity.current > IDLE_LOCK_MS && !receipt) lock();
    }, 15_000);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
      clearInterval(t);
    };
  }, [staff, lock, receipt, autoLogin]);

  const totals = useMemo(() => (day ? computeDayTotals(day, orders, expenses, movements) : null), [day, orders, expenses, movements]);
  const nextToken = useMemo(() => (orders.length ? Math.max(...orders.map((o) => o.token)) + 1 : 1), [orders]);

  if (bootError) {
    if (bootError.code === "no_device" && store.setDeviceKey) {
      return (
        <DeviceSetup
          store={store}
          message={bootError.message}
          onSave={(key) => {
            store.setDeviceKey?.(key);
            loadApp();
          }}
        />
      );
    }
    return (
      <main className="page stack" style={{ maxWidth: 560, margin: "0 auto" }}>
        <div className="error">Could not start: {bootError.message}</div>
        <button type="button" className="btn btn-dark btn-big" onClick={loadApp}>
          Try again
        </button>
        {store.setDeviceKey ? (
          <button
            type="button"
            className="btn btn-big"
            onClick={() => {
              store.setDeviceKey?.("");
              loadApp();
            }}
          >
            Enter a different device key
          </button>
        ) : null}
        {"serverUrl" in store ? <p className="small muted">Supabase address in use: {String((store as { serverUrl: string }).serverUrl)}</p> : null}
      </main>
    );
  }
  if (!boot) return <main className="page muted">Loading…</main>;

  if (!staff && autoLogin && !autoLoginFailed) return <main className="page muted">Signing in…</main>;

  if (!staff) {
    return (
      <LockScreen
        boot={boot}
        demo={store.kind === "demo"}
        onLogin={async (pin) => {
          const s = await store.login(pin);
          if (s) {
            lastActivity.current = Date.now();
            setStaff(s);
            await refreshDay();
          }
          return s;
        }}
      />
    );
  }

  if (!dayLoaded) return <main className="page muted">Loading…</main>;

  if (!day) {
    return (
      <>
        <OpenDayScreen
          staff={staff}
          onLock={lock}
          onOpen={async (floatPaise) => {
            await store.openDay(floatPaise);
            await refreshDay();
            setView("order");
          }}
        />
        <Toast message={toast} onDone={clearToast} />
      </>
    );
  }

  const printOrder = (order: Order, duplicate = false) =>
    svc.enqueue(
      `${duplicate ? "Reprint" : "Bill"} ${order.billNo}`,
      layoutReceipt(order, boot.outlet, { width: svc.getSettings().width, duplicate }),
    );

  const saveOrder = async (order: Order, isRetry = false): Promise<boolean> => {
    try {
      await store.submitOrder(order);
    } catch (e) {
      setFailedSave({ order, error: errorText(e) });
      return false;
    }
    setFailedSave(null);
    if (isRetry) setCartKey((k) => k + 1);
    setOrders((os) => [order, ...os.filter((o) => o.id !== order.id)]);
    const jobId = svc.getSettings().autoPrint ? printOrder(order) : null;
    setReceipt({ order, jobId });
    return true;
  };

  const submit = async (draft: OrderDraft, payments: Payment[]): Promise<boolean> => {
    const { billNo, token } = await store.nextBillNumber();
    const subtotal = subtotalPaise(draft.lines);
    const order: Order = {
      id: uuid(),
      billNo,
      token,
      deviceCode: boot.device.code,
      staffId: staff.id,
      staffName: staff.name,
      daySessionId: day.id,
      channel: draft.channel,
      service: draft.service,
      externalOrderId: draft.externalOrderId,
      note: draft.note,
      lines: draft.lines,
      subtotalPaise: subtotal,
      discount: draft.discount,
      totalPaise: totalPaise(draft.lines, draft.discount?.amountPaise ?? 0),
      payments,
      createdAt: new Date().toISOString(),
      menuVersion: boot.menu.version,
      voided: null,
    };
    return saveOrder(order);
  };

  const billCount = orders.filter((o) => !o.voided).length;
  const printerLabel = svc.getSettings().mode === "none" ? "Printer: off" : svc.getJobs().some((j) => j.status === "failed") ? "Printer: failed" : "Printer";
  const nav: [View, string][] = [
    ["order", "New order"],
    ["orders", `Orders today (${billCount})`],
    ["expense", "Expense / cash"],
    ["day", "Close day"],
    ["printer", printerLabel],
  ];
  const go = (v: View) => {
    setView(v);
    setMenuOpen(false);
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div className="row topbar-title">
          {store.kind === "demo" ? (
            <span className="badge-demo">DEMO · not connected</span>
          ) : boot.outlet.isDemo ? (
            <span className="badge-demo">DEMO OUTLET</span>
          ) : null}
          <strong>{boot.outlet.name}</strong>
          <span className="muted small">
            {boot.device.code} · {day.businessDate}
          </span>
          {day.businessDate !== businessDate() ? (
            <button type="button" className="btn" style={{ minHeight: 36, background: "var(--warn-bg)", borderColor: "var(--warn-line)" }} onClick={() => go("day")}>
              Opened on {day.businessDate}: close it
            </button>
          ) : null}
        </div>
        {view !== "order" ? (
          <button type="button" className="btn" onClick={() => go("order")}>
            ← New order
          </button>
        ) : null}
        <button type="button" className="btn menu-btn" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
          <span aria-hidden="true">☰</span>
          {svc.getJobs().some((j) => j.status === "failed") ? <span className="dot-bad" aria-label="printer problem" /> : null}
        </button>
      </header>

      {menuOpen ? (
        <div className="drawer-backdrop" onClick={() => setMenuOpen(false)}>
          <nav className="drawer" aria-label="Counter" onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <strong>{staff.name}</strong>
              <button type="button" className="btn" onClick={() => setMenuOpen(false)}>
                Close
              </button>
            </div>
            {totals ? (
              <div className="drawer-totals">
                <span>Sales</span>
                <strong>{formatRupees(totals.salesPaise)}</strong>
                <span>Cash</span>
                <strong>{formatRupees(totals.cashSalesPaise)}</strong>
                <span>UPI</span>
                <strong>{formatRupees(totals.upiSalesPaise)}</strong>
                <span>Cash in drawer</span>
                <strong>{formatRupees(totals.expectedCashPaise)}</strong>
              </div>
            ) : null}
            {nav.map(([v, label]) => (
              <button key={v} type="button" className="btn btn-big drawer-link" aria-current={view === v ? "page" : undefined} onClick={() => go(v)}>
                {label}
              </button>
            ))}
            {autoLogin ? null : (
              <button type="button" className="btn btn-big drawer-link" onClick={lock}>
                Lock
              </button>
            )}
          </nav>
        </div>
      ) : null}

      {view === "order" ? (
        <OrderScreen
          key={cartKey}
          menu={boot.menu}
          outlet={boot.outlet}
          staff={staff}
          soldOut={soldOut}
          nextToken={nextToken}
          photos={photos}
          approveAsOwner={(pin) => store.approveAsOwner(pin)}
          notify={setToast}
          onToggleSoldOut={async (id, out) => {
            setSoldOut((s) => {
              const n = new Set(s);
              if (out) n.add(id);
              else n.delete(id);
              return n;
            });
            try {
              await store.setSoldOut(id, out);
              setToast(out ? "Marked sold out" : "Back in stock");
            } catch (e) {
              setToast(errorText(e));
            }
          }}
          onSubmit={submit}
        />
      ) : null}
      {view === "orders" ? (
        <OrdersToday
          orders={orders}
          outlet={boot.outlet}
          staff={staff}
          onReprint={(o) => {
            printOrder(o, true);
            setToast(`Reprinting ${o.billNo}`);
          }}
          onVoid={async (id, reason, pin) => {
            await store.voidOrder(id, reason, pin);
            setOrders(await store.listOrders(day.id));
            setToast("Bill voided");
          }}
        />
      ) : null}
      {view === "expense" && totals ? (
        <ExpenseScreen
          totals={totals}
          expenses={expenses}
          movements={movements}
          notify={setToast}
          onAddExpense={async (e) => {
            const row = await store.addExpense(e);
            setExpenses((xs) => [...xs, row]);
          }}
          onAddMovement={async (m) => {
            const row = await store.addCashMovement(m);
            setMovements((xs) => [...xs, row]);
          }}
        />
      ) : null}
      {view === "day" && totals ? (
        <CloseDayScreen
          day={day}
          totals={totals}
          menu={boot.menu}
          onPrintReport={() => {
            if (svc.getSettings().mode === "none") return setToast("Set up a printer first.");
            svc.enqueue("Day report", layoutDayReport(day, totals, boot.outlet, { width: svc.getSettings().width }));
          }}
          onClose={async (counted, leftovers) => {
            const closed = await store.closeDay({ countedCashPaise: counted, leftovers });
            if (svc.getSettings().mode !== "none") {
              svc.enqueue("Day report", layoutDayReport(closed, totals, boot.outlet, { width: svc.getSettings().width }));
            }
            const v = closed.variancePaise ?? 0;
            setToast(`Day closed. ${v === 0 ? "Cash matches." : v < 0 ? `${formatRupees(-v)} short.` : `${formatRupees(v)} extra.`}`);
            await refreshDay();
          }}
        />
      ) : null}
      {view === "printer" ? <PrinterScreen outlet={boot.outlet} /> : null}


      {receipt ? (
        <ReceiptSheet
          order={receipt.order}
          outlet={boot.outlet}
          jobId={receipt.jobId}
          onNewOrder={() => setReceipt(null)}
          onPrint={() => setReceipt((r) => (r ? { ...r, jobId: printOrder(r.order, true) } : r))}
          onOpenPrinter={() => {
            setReceipt(null);
            setView("printer");
          }}
        />
      ) : null}

      {failedSave ? (
        <Sheet title="Bill not saved yet" onClose={() => setFailedSave(null)}>
          <div className="error">{failedSave.error}</div>
          <p className="muted" style={{ margin: 0 }}>
            The order is still in the cart. Retrying uses the same bill number, so it can never be saved twice.
          </p>
          <button type="button" className="btn btn-dark btn-big" onClick={() => void saveOrder(failedSave.order, true)}>
            Retry saving {failedSave.order.billNo}
          </button>
        </Sheet>
      ) : null}

      <Toast message={toast} onDone={clearToast} />
    </div>
  );
}

function DeviceSetup({ store, message, onSave }: { store: PosStore; message: string; onSave: (key: string) => void }) {
  const [key, setKey] = useState("");
  const [choices, setChoices] = useState<DeviceChoice[] | null>(null);
  const [picked, setPicked] = useState<DeviceChoice | null>(null);
  useEffect(() => {
    store
      .deviceChoices?.()
      .then((c) => {
        setChoices(c);
        if (c.length === 1) setPicked(c[0]);
      })
      .catch(() => setChoices([]));
  }, [store]);

  // Step 1: pick which device this is (the outlet's devices, by name).
  if (choices && choices.length > 0 && !picked) {
    return (
      <main className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}>
        <div className="card stack" style={{ width: "min(520px, 100%)", gap: 16 }}>
          <h1 style={{ fontSize: 24 }}>Sign in</h1>
          <p className="muted" style={{ margin: 0 }}>
            {choices[0].outlet}: choose your device.
          </p>
          {message && !/not set up yet/.test(message) ? <div className="error small">{message}</div> : null}
          <div className="stack" style={{ gap: 12 }}>
            {choices.map((c) => (
              <button key={c.code} type="button" className="btn btn-dark btn-big" onClick={() => setPicked(c)}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}>
      <form
        className="card stack"
        style={{ width: "min(520px, 100%)", gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) onSave(key);
        }}
      >
        <h1 style={{ fontSize: 24 }}>{picked ? picked.name : "Set up this counter"}</h1>
        {picked ? (
          <p className="muted" style={{ margin: 0 }}>
            Enter the device key for {picked.name}. This phone remembers it, so it&apos;s only asked once.
          </p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {message} It&apos;s the key chosen when this device was registered in Supabase. It is entered once per device.
          </p>
        )}
        {picked && message && !/not set up yet/.test(message) ? <div className="error small">{message}</div> : null}
        <label className="field">
          Device key
          <input
            className="input input-big"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            autoFocus
          />
        </label>
        <button type="submit" className="btn btn-dark btn-big" disabled={!key.trim()}>
          Sign in
        </button>
        {picked && choices && choices.length > 1 ? (
          <button type="button" className="btn" onClick={() => setPicked(null)}>
            Choose a different device
          </button>
        ) : null}
      </form>
    </main>
  );
}
