import { formatBillNo } from "@/lib/domain/billing";
import type { CashMovement, DaySession, Expense, Order, Paise, Payment, Staff } from "@/lib/domain/types";
import {
  type Bootstrap,
  type CloseDayInput,
  type DeviceChoice,
  type ItemPhoto,
  type OwnerApproval,
  type PosStore,
  StoreError,
  type StoreErrorCode,
} from "./store";

const DEVICE_KEY = "cpos.deviceKey";
const SEQ_KEY = (deviceId: string) => `cpos.billSeq.${deviceId}`;
const TOKEN_KEY = (dayId: string) => `cpos.token.${dayId}`;

const KNOWN_CODES: StoreErrorCode[] = [
  "no_device",
  "no_session",
  "no_open_day",
  "not_allowed",
  "invalid",
  "network",
  "conflict",
  "locked",
];

/**
 * Talks to the Supabase backend through its Postgres functions (pos_*), called over
 * the REST endpoint Supabase exposes for them. All business rules run in the database.
 */
export class SupabaseStore implements PosStore {
  readonly kind = "supabase" as const;
  private session: string | null = null;
  private deviceId: string | null = null;
  private deviceCode: string | null = null;
  private dayId: string | null = null;
  private autoLoginDevice = false;

  constructor(
    private readonly url: string,
    private readonly anonKey: string,
    private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = safeLocalStorage(),
  ) {}

  setDeviceKey(key: string): void {
    if (key.trim()) this.storage?.setItem(DEVICE_KEY, key.trim());
    else this.storage?.removeItem(DEVICE_KEY);
  }

  /** The Supabase address in use, shown on error screens to help setup. */
  get serverUrl(): string {
    return this.url;
  }

  private deviceKey(): string {
    const key = this.storage?.getItem(DEVICE_KEY);
    if (!key) throw new StoreError("This tablet is not set up yet. Enter the device key.", "no_device");
    return key;
  }

  async load(): Promise<Bootstrap & { lastBillSeq?: number }> {
    const b = await this.rpc<(Bootstrap & { lastBillSeq: number }) | { error: string }>("pos_bootstrap", {
      p_device_key: this.deviceKey(),
    });
    if ("error" in b) {
      // Forget a rejected key right away so it isn't retried on every reload (each retry
      // counts as a wrong key and would trip the wrong-key pause).
      this.storage?.removeItem(DEVICE_KEY);
      throw new StoreError("That device key isn't right. Choose your device and enter its key again.", "no_device");
    }
    this.autoLoginDevice = !!b.autoLogin;
    this.deviceId = b.device.id;
    this.deviceCode = b.device.code;
    // Never go below what the server has already seen from this device.
    const local = Number(this.storage?.getItem(SEQ_KEY(b.device.id)) ?? 0);
    this.storage?.setItem(SEQ_KEY(b.device.id), String(Math.max(local, b.lastBillSeq)));
    return b;
  }

  async login(pin: string): Promise<Staff | null> {
    const r = await this.rpc<{ session: string; staff: Staff } | { error: string } | null>("pos_login", {
      p_device_key: this.deviceKey(),
      p_pin: pin,
    });
    if (r && "error" in r) {
      this.storage?.removeItem(DEVICE_KEY);
      throw new StoreError("This device's key is no longer valid. Set it up again.", "no_device");
    }
    this.session = r?.session ?? null;
    return r?.staff ?? null;
  }

  async deviceChoices(): Promise<DeviceChoice[]> {
    return this.rpc<DeviceChoice[]>("pos_device_choices", {});
  }

  async autoLogin(): Promise<Staff | null> {
    const r = await this.rpc<{ session: string; staff: Staff } | { error: string }>("pos_device_login", {
      p_device_key: this.deviceKey(),
    });
    if ("error" in r) {
      if (r.error === "no_device") {
        this.storage?.removeItem(DEVICE_KEY);
        throw new StoreError("That device key isn't right. Choose your device and enter its key again.", "no_device");
      }
      return null; // this device needs a PIN
    }
    this.session = r.session;
    return r.staff;
  }

  async approveAsOwner(pin: string): Promise<OwnerApproval | null> {
    return this.rpc<OwnerApproval | null>("pos_owner_approval", { p_session: this.requireSession(), p_pin: pin });
  }

  async logout(): Promise<void> {
    const s = this.session;
    this.session = null;
    if (s) await this.rpc("pos_logout", { p_session: s }).catch(() => undefined);
  }

  async currentDay(): Promise<DaySession | null> {
    const d = await this.rpc<(DaySession & { lastToken: number }) | null>("pos_current_day", {
      p_session: this.requireSession(),
    });
    this.trackDay(d);
    return d;
  }

  async openDay(openingFloatPaise: Paise): Promise<DaySession> {
    const d = await this.rpc<DaySession & { lastToken: number }>("pos_open_day", {
      p_session: this.requireSession(),
      p_opening_float_paise: openingFloatPaise,
    });
    this.trackDay(d);
    return d;
  }

  async closeDay(input: CloseDayInput): Promise<DaySession> {
    const d = await this.rpc<DaySession>("pos_close_day", {
      p_session: this.requireSession(),
      p_counted_cash_paise: input.countedCashPaise,
      p_leftovers: input.leftovers,
    });
    this.dayId = null;
    return d;
  }

  async nextBillNumber(): Promise<{ billNo: string; token: number }> {
    if (!this.deviceId || !this.deviceCode) throw new StoreError("App not loaded.", "invalid");
    if (!this.dayId) throw new StoreError("Open the day first.", "no_open_day");
    const seq = Number(this.storage?.getItem(SEQ_KEY(this.deviceId)) ?? 0) + 1;
    const token = Number(this.storage?.getItem(TOKEN_KEY(this.dayId)) ?? 0) + 1;
    this.storage?.setItem(SEQ_KEY(this.deviceId), String(seq));
    this.storage?.setItem(TOKEN_KEY(this.dayId), String(token));
    return { billNo: formatBillNo(this.deviceCode, seq), token };
  }

  async submitOrder(order: Order): Promise<void> {
    await this.rpc("pos_submit_order", { p_session: this.requireSession(), p_order: { ...order, payLater: !!order.unpaid } });
  }

  async settleOrder(orderId: string, payments: Payment[]): Promise<Order> {
    return this.rpc<Order>("pos_settle_order", { p_session: this.requireSession(), p_order: orderId, p_payments: payments });
  }

  async listOrders(daySessionId: string): Promise<Order[]> {
    return this.rpc<Order[]>("pos_list_orders", { p_session: this.requireSession(), p_day: daySessionId });
  }

  async voidOrder(orderId: string, reason: string, approverPin: string | null): Promise<void> {
    const r = await this.rpc<{ error?: string }>("pos_void_order", {
      p_session: this.requireSession(),
      p_order: orderId,
      p_reason: reason,
      p_approver_pin: approverPin,
    });
    if (r?.error === "owner_pin") throw new StoreError("That is not the owner PIN.", "not_allowed");
  }

  async addExpense(e: Omit<Expense, "id" | "createdAt" | "staffId" | "staffName" | "daySessionId">): Promise<Expense> {
    return this.rpc<Expense>("pos_add_expense", {
      p_session: this.requireSession(),
      p_category: e.category,
      p_amount_paise: e.amountPaise,
      p_method: e.method,
      p_note: e.note,
    });
  }

  async listExpenses(daySessionId: string): Promise<Expense[]> {
    return this.rpc<Expense[]>("pos_list_expenses", { p_session: this.requireSession(), p_day: daySessionId });
  }

  async addCashMovement(
    m: Omit<CashMovement, "id" | "createdAt" | "staffId" | "staffName" | "daySessionId">,
  ): Promise<CashMovement> {
    return this.rpc<CashMovement>("pos_add_cash_movement", {
      p_session: this.requireSession(),
      p_direction: m.direction,
      p_amount_paise: m.amountPaise,
      p_reason: m.reason,
    });
  }

  async listCashMovements(daySessionId: string): Promise<CashMovement[]> {
    return this.rpc<CashMovement[]>("pos_list_cash_movements", { p_session: this.requireSession(), p_day: daySessionId });
  }

  async setSoldOut(sellableId: string, soldOut: boolean): Promise<void> {
    await this.rpc("pos_set_sold_out", { p_session: this.requireSession(), p_ref: sellableId, p_sold_out: soldOut });
  }

  async itemPhotos(have: Record<string, string>): Promise<ItemPhoto[]> {
    return this.rpc<ItemPhoto[]>("pos_item_photos", { p_session: this.requireSession(), p_have: have });
  }

  private trackDay(d: (DaySession & { lastToken?: number }) | null): void {
    this.dayId = d?.id ?? null;
    if (d && this.storage) {
      const local = Number(this.storage.getItem(TOKEN_KEY(d.id)) ?? 0);
      this.storage.setItem(TOKEN_KEY(d.id), String(Math.max(local, d.lastToken ?? 0)));
    }
  }

  private requireSession(): string {
    if (!this.session) throw new StoreError("Please log in with your PIN.", "no_session");
    return this.session;
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>, retried = false): Promise<T> {
    try {
      return await this.rpcOnce<T>(fn, args);
    } catch (e) {
      // A device that signs in by key just signs in again when its session runs out (e.g. overnight).
      if (!retried && e instanceof StoreError && e.code === "no_session" && this.autoLoginDevice && "p_session" in args) {
        await this.autoLogin();
        return this.rpc<T>(fn, { ...args, p_session: this.session }, true);
      }
      throw e;
    }
  }

  private async rpcOnce<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.anonKey,
          // Legacy anon keys are JWTs and also go in Authorization. Newer "publishable"
          // keys (sb_publishable_…) must only be sent as apikey.
          ...(this.anonKey.startsWith("eyJ") ? { Authorization: `Bearer ${this.anonKey}` } : {}),
        },
        body: JSON.stringify(args),
      });
    } catch {
      const online = typeof navigator === "undefined" || navigator.onLine;
      throw new StoreError(
        online
          ? `Can't reach the Supabase server at ${this.url}. Check that the URL setting in Vercel is your Supabase Project URL (looks like https://abcd1234.supabase.co), then redeploy.`
          : "No internet connection. Check Wi-Fi and try again.",
        "network",
      );
    }
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      // PostgREST: function not found → the SQL setup files haven't been run in this project yet.
      if (body?.code === "PGRST202" || res.status === 404) {
        throw new StoreError(
          "Connected to Supabase, but the database isn't set up (or is missing the latest update). In Supabase → SQL Editor, run supabase/setup/all-in-one.sql, or the newest migration file if you ran it before.",
          "invalid",
        );
      }
      const hint = body?.hint as StoreErrorCode | undefined;
      const code = hint && KNOWN_CODES.includes(hint) ? hint : res.status >= 500 ? "network" : "invalid";
      if (code === "no_session") this.session = null;
      throw new StoreError(body?.message ?? `Server error (${res.status}).`, code);
    }
    return body as T;
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
