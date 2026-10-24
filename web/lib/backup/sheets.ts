import type { CashMovement, DaySession, Expense, Order } from "@/lib/domain/types";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

const QUEUE_KEY = "cpos.sheets.queue.v1";
const BATCH = 40;

/** One row for one tab of the backup Google Sheet. `id` makes re-sending a row harmless. */
export interface SheetRow {
  id: string;
  sheet: "Bills" | "Items" | "Expenses" | "Days" | "Events";
  headers: string[];
  values: (string | number)[];
}

export type BackupStatus =
  | { state: "off" } // no Google Sheet set up for this site
  | { state: "ok"; pending: 0 }
  | { state: "sending" | "failing"; pending: number; error?: string };

const rupees = (p: number) => Math.round(p) / 100;
const ist = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

const BILL_HEADERS = [
  "Time (IST)", "Business date", "Bill no", "Token", "Device", "Staff", "Type", "Items",
  "Subtotal ₹", "Discount ₹", "Discount reason", "Total ₹", "Cash ₹", "UPI ₹", "Note", "Saved in database when printed",
];

export function billRows(o: Order, businessDate: string, savedInDb: boolean): SheetRow[] {
  const paid = (m: "cash" | "upi") => rupees(o.payments.filter((p) => p.method === m).reduce((s, p) => s + p.amountPaise, 0));
  const lineName = (l: Order["lines"][number]) =>
    l.name + (l.modifiers.length ? ` (${l.modifiers.map((m) => m.name).join(", ")})` : "");
  const bill: SheetRow = {
    id: o.id,
    sheet: "Bills",
    headers: BILL_HEADERS,
    values: [
      ist(o.createdAt), businessDate, o.billNo, o.token, o.deviceCode, o.staffName, o.channel,
      o.lines.map((l) => `${l.qty}× ${lineName(l)}`).join("; "),
      rupees(o.subtotalPaise), rupees(o.discount?.amountPaise ?? 0), o.discount?.reason ?? "", rupees(o.totalPaise),
      paid("cash"), paid("upi"), o.note ?? "", savedInDb ? "yes" : "NO – kept on phone, saved later",
    ],
  };
  const items: SheetRow[] = o.lines.map((l, i) => {
    const unit = l.unitPricePaise + l.modifiers.reduce((s, m) => s + m.pricePaise, 0);
    return {
      id: `${o.id}:${i + 1}`,
      sheet: "Items",
      headers: ["Time (IST)", "Business date", "Bill no", "Item", "Qty", "Unit price ₹", "Line total ₹"],
      values: [ist(o.createdAt), businessDate, o.billNo, lineName(l), l.qty, rupees(unit), rupees(unit * l.qty)],
    };
  });
  return [bill, ...items];
}

const EVENT_HEADERS = ["Time (IST)", "Event", "Bill no", "Details"];

export function eventRow(id: string, event: string, billNo: string, details: string): SheetRow {
  return { id, sheet: "Events", headers: EVENT_HEADERS, values: [ist(new Date().toISOString()), event, billNo, details] };
}

export function expenseRow(e: Expense, businessDate: string): SheetRow {
  return {
    id: e.id,
    sheet: "Expenses",
    headers: ["Time (IST)", "Business date", "Kind", "Category / reason", "Amount ₹", "Paid by", "Note", "Staff"],
    values: [ist(e.createdAt), businessDate, "expense", e.category, rupees(e.amountPaise), e.method, e.note ?? "", e.staffName],
  };
}

export function movementRow(m: CashMovement, businessDate: string): SheetRow {
  return {
    id: m.id,
    sheet: "Expenses",
    headers: ["Time (IST)", "Business date", "Kind", "Category / reason", "Amount ₹", "Paid by", "Note", "Staff"],
    values: [ist(m.createdAt), businessDate, m.direction === "in" ? "cash added" : "cash taken out", m.reason, rupees(m.amountPaise), "cash", "", m.staffName],
  };
}

export function dayRow(d: DaySession, event: "opened" | "closed", device: string): SheetRow {
  return {
    id: `${d.id}:${event}`,
    sheet: "Days",
    headers: ["Time (IST)", "Business date", "Event", "Device", "Opening cash ₹", "Expected cash ₹", "Counted cash ₹", "Difference ₹"],
    values: [
      ist(event === "opened" ? d.openedAt : d.closedAt ?? new Date().toISOString()), d.businessDate, event, device,
      rupees(d.openingFloatPaise),
      d.expectedCashPaise == null ? "" : rupees(d.expectedCashPaise),
      d.countedCashPaise == null ? "" : rupees(d.countedCashPaise),
      d.variancePaise == null ? "" : rupees(d.variancePaise),
    ],
  };
}

/**
 * Copies everything the counter records into a Google Sheet, through this site's
 * /api/backup route. Rows wait on the phone until the sheet confirms them, so nothing
 * is dropped when the internet or Google is slow; the status is always visible.
 */
export class SheetsBackup {
  private status: BackupStatus;
  private listeners = new Set<(s: BackupStatus) => void>();
  private sending = false;
  private configured: boolean | null = null;

  constructor(
    private readonly endpoint = "/api/backup",
    private readonly storage: Storage | null = safeLocalStorage(),
  ) {
    const pending = this.queue().length;
    this.status = pending ? { state: "sending", pending } : { state: "ok", pending: 0 };
  }

  getStatus(): BackupStatus {
    return this.status;
  }

  subscribe(fn: (s: BackupStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  add(rows: SheetRow[]): void {
    if (this.configured === false) return; // no sheet set up for this site
    const q = this.queue();
    const have = new Set(q.map((r) => r.id));
    this.write([...q, ...rows.filter((r) => !have.has(r.id))]);
    void this.flush();
  }

  /** Sends what's waiting. Safe to call often; only one send runs at a time. */
  async flush(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      if (this.configured === null) this.configured = await this.checkConfigured();
      if (this.configured === null) {
        return this.set({ state: "failing", pending: this.queue().length, error: "Can't reach the Google Sheet backup (no internet?)." });
      }
      if (!this.configured) return this.set({ state: "off" });
      for (;;) {
        const q = this.queue();
        if (!q.length) return this.set({ state: "ok", pending: 0 });
        this.set({ state: "sending", pending: q.length });
        const batch = q.slice(0, BATCH);
        let error: string | null = null;
        try {
          const res = await fetch(this.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: batch }),
            signal: AbortSignal.timeout(30_000),
          });
          const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
          if (res.status === 501) {
            this.configured = false;
            return this.set({ state: "off" });
          }
          if (!res.ok || !body?.ok) error = body?.error ?? `Backup failed (${res.status}).`;
        } catch {
          error = "Can't reach the Google Sheet backup (no internet?).";
        }
        if (error) return this.set({ state: "failing", pending: q.length, error });
        const sent = new Set(batch.map((r) => r.id));
        this.write(this.queue().filter((r) => !sent.has(r.id)));
      }
    } finally {
      this.sending = false;
    }
  }

  /** Null when it can't be told (offline): rows are kept and it's asked again next time. */
  private async checkConfigured(): Promise<boolean | null> {
    try {
      const res = await fetch(this.endpoint, { signal: AbortSignal.timeout(15_000) });
      const body = (await res.json().catch(() => null)) as { configured?: boolean } | null;
      return res.ok && !!body?.configured;
    } catch {
      return null;
    }
  }

  private set(s: BackupStatus): void {
    this.status = s;
    for (const fn of this.listeners) fn(s);
  }

  private queue(): SheetRow[] {
    try {
      const v = JSON.parse(this.storage?.getItem(QUEUE_KEY) ?? "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  private write(q: SheetRow[]): void {
    try {
      this.storage?.setItem(QUEUE_KEY, JSON.stringify(q));
    } catch {
      this.set({ state: "failing", pending: q.length, error: "This phone's storage is full." });
    }
  }
}

export function describeBackup(s: BackupStatus): string {
  switch (s.state) {
    case "off":
      return "Sheet backup: not set up";
    case "ok":
      return "Sheet backup: up to date";
    case "sending":
      return `Sheet backup: sending ${s.pending}`;
    case "failing":
      return `Sheet backup: ${s.pending} waiting`;
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
