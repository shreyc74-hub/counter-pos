"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type BackupStatus, SheetsBackup, billRows, dayRow, describeBackup, eventRow, expenseRow, movementRow } from "@/lib/backup/sheets";
import { createStore } from "@/lib/data";
import { type UnsavedBill, UnsavedBills, clearSnapshot, loadSnapshot, mergeUnsaved, saveSnapshot } from "@/lib/data/offline";
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
const HEALTH_CHECK_MS = 30_000;

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
  const [failedSave, setFailedSave] = useState<{ order: Order; error: string; canKeep: boolean } | null>(null);
  // Bills printed while the database was unreachable, kept on this phone until it confirms them.
  const unsavedStore = useMemo(() => new UnsavedBills(), []);
  const [unsaved, setUnsaved] = useState(() => unsavedStore.list());
  const unsavedIds = useMemo(() => new Set(unsaved.map((b) => b.order.id)), [unsaved]);
  // Copy of everything into the owner's Google Sheet.
  const backup = useMemo(() => new SheetsBackup(), []);
  const [backupStatus, setBackupStatus] = useState<BackupStatus>(() => backup.getStatus());
  useEffect(() => backup.subscribe(setBackupStatus), [backup]);
  // False while the database can't be reached. `offline`: started from this phone's last snapshot.
  const [dbOk, setDbOk] = useState(true);
  const [offline, setOffline] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Remounting the order screen empties its cart (used after a retried save succeeds).
  const [cartKey, setCartKey] = useState(0);
  const clearToast = useCallback(() => setToast(null), []);

  const loadApp = useCallback(() => {
    setBootError(null);
    store
      .load()
      .then((b) => {
        setBoot(b);
        setSoldOut(new Set(b.soldOut));
      })
      .catch((e) => {
        // Database unreachable on start: carry on from what this phone last showed, so billing
        // never stops. Bills made now are kept on the phone and saved once it's back.
        const snap = e instanceof StoreError && e.code === "network" ? loadSnapshot() : null;
        if (snap && snap.boot.autoLogin && store.resumeOffline) {
          store.resumeOffline(snap.boot, snap.day);
          setBoot(snap.boot);
          setSoldOut(new Set(snap.boot.soldOut));
          setStaff(snap.staff);
          setDay(snap.day);
          setOrders(mergeUnsaved(snap.orders, unsavedStore.list(), snap.day.id));
          setExpenses(snap.expenses);
          setMovements(snap.movements);
          setDayLoaded(true);
          setOffline(true);
          setDbOk(false);
          return;
        }
        setBootError({ message: errorText(e), code: e instanceof StoreError ? e.code : null });
      });
  }, [store, unsavedStore]);
  useEffect(loadApp, [loadApp]);

  const refreshDay = useCallback(async () => {
    const d = await store.currentDay();
    setDay(d);
    setDayLoaded(true);
    setDbOk(true);
    if (d) {
      const [o, e, m] = await Promise.all([store.listOrders(d.id), store.listExpenses(d.id), store.listCashMovements(d.id)]);
      setOrders(mergeUnsaved(o, unsavedStore.list(), d.id));
      setExpenses(e);
      setMovements(m);
    } else {
      setOrders([]);
      setExpenses([]);
      setMovements([]);
    }
  }, [store, unsavedStore]);

  // Remember what the counter shows, for starting up while the database is unreachable.
  useEffect(() => {
    if (!boot || !staff || !dayLoaded) return;
    if (day) saveSnapshot({ boot: { ...boot, soldOut: [...soldOut] }, staff, day, orders, expenses, movements });
    else clearSnapshot();
  }, [boot, staff, day, dayLoaded, orders, expenses, movements, soldOut]);

  // Send kept bills to the database, oldest first. Stops at the first network failure.
  const flushing = useRef(false);
  const flushUnsaved = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (const b of unsavedStore.list()) {
        if (b.refused) continue;
        try {
          await store.submitOrder(b.order);
        } catch (e) {
          if (e instanceof StoreError && e.code === "network") {
            setDbOk(false);
            return;
          }
          setUnsaved(unsavedStore.markRefused(b.order.id, errorText(e)));
          backup.add([eventRow(`${b.order.id}:refused`, "DATABASE REFUSED A KEPT BILL", b.order.billNo, errorText(e))]);
          continue;
        }
        setDbOk(true);
        setUnsaved(unsavedStore.remove(b.order.id));
        backup.add([eventRow(`${b.order.id}:saved-late`, "Kept bill saved to database", b.order.billNo, "")]);
      }
    } finally {
      flushing.current = false;
    }
  }, [store, unsavedStore, backup]);

  // Health check: is the database reachable? Also retries kept bills and the sheet backup.
  useEffect(() => {
    if (!staff) return;
    let stopped = false;
    const check = async () => {
      void backup.flush();
      try {
        await store.ping?.();
      } catch {
        if (!stopped) setDbOk(false);
        return;
      }
      if (stopped) return;
      setDbOk(true);
      if (unsavedStore.list().some((b) => !b.refused)) await flushUnsaved();
      if (offline) {
        try {
          await refreshDay();
          setOffline(false);
        } catch {
          setDbOk(false);
        }
      }
    };
    const t = setInterval(() => void check(), HEALTH_CHECK_MS);
    const onOnline = () => void check();
    window.addEventListener("online", onOnline);
    void check();
    return () => {
      stopped = true;
      clearInterval(t);
      window.removeEventListener("online", onOnline);
    };
  }, [staff, store, backup, unsavedStore, flushUnsaved, offline, refreshDay]);

  const lock = useCallback(() => {
    void store.logout();
    setStaff(null);
    setView("order");
  }, [store]);

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
            const opened = await store.openDay(floatPaise);
            backup.add([dayRow(opened, "opened", boot.device.code)]);
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
      const network = e instanceof StoreError && e.code === "network";
      if (network) setDbOk(false);
      setFailedSave({ order, error: errorText(e), canKeep: network });
      return false;
    }
    setDbOk(true);
    backup.add(billRows(order, day.businessDate, true));
    afterSave(order, isRetry);
    return true;
  };

  // Database unreachable: print now, keep the bill on this phone, and save it automatically later.
  const keepUnsaved = (order: Order) => {
    try {
      setUnsaved(unsavedStore.add(order));
    } catch {
      setToast("This phone's storage is full, so the bill can't be kept. Write it down and retry.");
      return;
    }
    backup.add(billRows(order, day.businessDate, false));
    afterSave(order, true);
  };

  const afterSave = (order: Order, isRetry: boolean) => {
    setFailedSave(null);
    if (isRetry) setCartKey((k) => k + 1);
    setOrders((os) => [order, ...os.filter((o) => o.id !== order.id)]);
    const jobId = svc.getSettings().autoPrint ? printOrder(order) : null;
    setReceipt({ order, jobId });
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

  const nav: [View, string][] = [
    ["order", "New order"],
    ["orders", `Orders today (${orders.filter((o) => !o.voided).length})`],
    ["expense", "Expense / cash"],
    ["day", "Close day"],
    ["printer", svc.getSettings().mode === "none" ? "Printer: off" : svc.getJobs().some((j) => j.status === "failed") ? "Printer: failed" : "Printer"],
  ];

  return (
    <div className="screen">
      <header className="topbar">
        <div className="row">
          {store.kind === "demo" ? (
            <span className="badge-demo">DEMO · not connected</span>
          ) : boot.outlet.isDemo ? (
            <span className="badge-demo">DEMO OUTLET</span>
          ) : null}
          <strong>{boot.outlet.name}</strong>
          <span className="muted small">
            Device {boot.device.code} · Day {day.businessDate}
          </span>
          {day.businessDate !== businessDate() ? (
            <button type="button" className="btn" style={{ minHeight: 36, background: "var(--warn-bg)", borderColor: "var(--warn-line)" }} onClick={() => setView("day")}>
              This day was opened on {day.businessDate}. Close it and open today&apos;s
            </button>
          ) : null}
        </div>
        {totals ? (
          <div className="row small muted" style={{ flexWrap: "wrap" }}>
            <span>Sales {formatRupees(totals.salesPaise)}</span>
            <span>Cash {formatRupees(totals.cashSalesPaise)}</span>
            <span>UPI {formatRupees(totals.upiSalesPaise)}</span>
            <span>Drawer {formatRupees(totals.expectedCashPaise)}</span>
          </div>
        ) : null}
        <HealthBar
          unsaved={unsaved}
          dbOk={dbOk}
          backup={backupStatus}
          onRetry={() => {
            void flushUnsaved();
            void backup.flush();
          }}
          onDismissRefused={(id) => setUnsaved(unsavedStore.remove(id))}
        />
      </header>

      {view === "order" ? (
        <OrderScreen
          key={cartKey}
          menu={boot.menu}
          outlet={boot.outlet}
          staff={staff}
          soldOut={soldOut}
          nextToken={nextToken}
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
          unsavedIds={unsavedIds}
          onVoid={async (id, reason, pin) => {
            if (unsavedIds.has(id)) {
              throw new Error("This bill hasn't reached the database yet. Void it after it's saved (when the red bar at the top is gone).");
            }
            await store.voidOrder(id, reason, pin);
            const voided = orders.find((o) => o.id === id);
            backup.add([eventRow(`${id}:void`, "Bill voided", voided?.billNo ?? "", reason)]);
            setOrders(mergeUnsaved(await store.listOrders(day.id), unsavedStore.list(), day.id));
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
            backup.add([expenseRow(row, day.businessDate)]);
            setExpenses((xs) => [...xs, row]);
          }}
          onAddMovement={async (m) => {
            const row = await store.addCashMovement(m);
            backup.add([movementRow(row, day.businessDate)]);
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
            if (unsaved.length) {
              throw new Error(
                `${unsaved.length} bill(s) haven't reached the database yet. Close the day once they're saved (red bar at the top).`,
              );
            }
            const closed = await store.closeDay({ countedCashPaise: counted, leftovers });
            backup.add([dayRow(closed, "closed", boot.device.code)]);
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

      <nav className="bottombar" aria-label="Counter">
        {nav.map(([v, label]) => (
          <button key={v} type="button" className="btn" aria-current={view === v ? "page" : undefined} onClick={() => setView(v)}>
            {label}
          </button>
        ))}
        <span className="who">{staff.name}</span>
        {autoLogin ? null : (
          <button type="button" className="btn" onClick={lock}>
            Lock
          </button>
        )}
      </nav>

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
          {failedSave.canKeep ? (
            <>
              <button type="button" className="btn btn-big" onClick={() => keepUnsaved(failedSave.order)}>
                Print now, save to database later
              </button>
              <p className="small muted" style={{ margin: 0 }}>
                The bill is kept on this phone (and sent to the Google Sheet) and saved to the database automatically as soon as it&apos;s
                reachable. A red bar shows until then.
              </p>
            </>
          ) : null}
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

/** Always-visible state of the data: bills not yet in the database, database reachability, sheet backup. */
function HealthBar({
  unsaved,
  dbOk,
  backup,
  onRetry,
  onDismissRefused,
}: {
  unsaved: UnsavedBill[];
  dbOk: boolean;
  backup: BackupStatus;
  onRetry: () => void;
  onDismissRefused: (orderId: string) => void;
}) {
  const waiting = unsaved.filter((b) => !b.refused);
  const refused = unsaved.filter((b) => b.refused);
  return (
    <>
      {waiting.length ? (
        <div className="health health-bad" role="alert">
          <span>
            <strong>
              {waiting.length} bill{waiting.length === 1 ? "" : "s"} NOT saved to the database yet
            </strong>{" "}
            ({waiting.map((b) => b.order.billNo).join(", ")}). Kept on this phone; {dbOk ? "saving now…" : "the database can't be reached, retrying every 30 s."} Don&apos;t
            clear this browser&apos;s data.
          </span>
          <button type="button" className="btn" onClick={onRetry}>
            Retry now
          </button>
        </div>
      ) : !dbOk ? (
        <div className="health health-warn" role="alert">
          <span>
            <strong>Database not reachable.</strong> You can keep billing: if a bill can&apos;t be saved you&apos;ll be asked, and it&apos;s kept on this
            phone until the database is back.
          </span>
          <button type="button" className="btn" onClick={onRetry}>
            Check again
          </button>
        </div>
      ) : null}
      {refused.map((b) => (
        <div key={b.order.id} className="health health-bad" role="alert">
          <span>
            <strong>The database refused bill {b.order.billNo}</strong> ({b.refused}). Note it down: total{" "}
            {formatRupees(b.order.totalPaise)}. It&apos;s also in the Google Sheet if that&apos;s set up.
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (window.confirm(`Remove bill ${b.order.billNo} from this phone? Only do this once you've noted it down.`)) onDismissRefused(b.order.id);
            }}
          >
            Noted, remove
          </button>
        </div>
      ))}
      {backup.state === "failing" ? (
        <div className="health health-warn" role="status">
          <span>
            <strong>{describeBackup(backup)}.</strong> {backup.error} Rows are kept and sent when it works again.
          </span>
          <button type="button" className="btn" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : (
        <span className="small muted" data-testid="backup-status">
          {describeBackup(backup)}
          {dbOk ? " · Database connected" : ""}
        </span>
      )}
    </>
  );
}
