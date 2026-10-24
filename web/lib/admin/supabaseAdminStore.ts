import type { Outlet } from "@/lib/domain/types";
import type { AdminMenu, AdminStore, Facts, OrderFact, PricePoint } from "./types";

const SESSION_KEY = "cpos.admin.session";
const DEVICE_SESSION_KEY = "cpos.admin.deviceSession";
/** Set by the counter app on this phone/browser; lets the admin panel open without a second sign-in. */
const COUNTER_DEVICE_KEY = "cpos.deviceKey";

interface DeviceSession {
  session: string;
  name: string;
  key: string;
}

interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  email: string;
}

type OrderRow = [string, number, string, string, OrderFact["channel"], number, number, number, number, number, boolean, string | null, [string, "variant" | "combo", number, number, number | null][] | null];

/**
 * Admin panel backed by Supabase. Two ways in:
 * - a device key (the same devices as the counter; only devices linked to the owner), or
 * - Supabase Auth email sign-in (link or 6-digit code).
 * The admin_* functions check the caller owns the outlet either way.
 */
export class SupabaseAdminStore implements AdminStore {
  readonly kind = "supabase" as const;

  constructor(
    private readonly url: string,
    private readonly anonKey: string,
  ) {
    this.captureLinkSignIn();
  }

  async currentUser(): Promise<string | null> {
    const d = this.loadDevice();
    if (d) return d.name;
    const s = await this.session();
    if (s) return s.email;
    // Same phone as the counter: reuse its device key.
    const counterKey = typeof window !== "undefined" ? window.localStorage.getItem(COUNTER_DEVICE_KEY) : null;
    if (counterKey && (await this.signInWithDevice(counterKey).catch(() => false))) return this.loadDevice()?.name ?? null;
    return null;
  }

  async deviceChoices(): Promise<{ code: string; name: string; outlet: string }[]> {
    return this.anonRpc("pos_device_choices", {});
  }

  async signInWithDevice(key: string): Promise<boolean> {
    const r = await this.anonRpc<{ session: string; staff: { name: string; role: string }; device: { name: string } } | { error: string }>(
      "pos_device_login",
      { p_device_key: key.trim() },
    );
    if ("error" in r) return false;
    if (r.staff.role !== "owner") throw new Error("This device isn't linked to the owner, so it can't open the admin panel.");
    window.localStorage.setItem(
      DEVICE_SESSION_KEY,
      JSON.stringify({ session: r.session, name: `${r.staff.name} · ${r.device.name}`, key: key.trim() } satisfies DeviceSession),
    );
    return true;
  }

  async startSignIn(email: string): Promise<void> {
    await this.auth("otp", {
      email: email.trim(),
      create_user: true,
      ...(typeof window !== "undefined" ? { email_redirect_to: `${window.location.origin}/admin` } : {}),
    });
  }

  async verifySignIn(email: string, code: string): Promise<boolean> {
    try {
      const r = await this.auth<{ access_token: string; refresh_token: string; expires_in: number; user: { email: string } }>("verify", {
        type: "email",
        email: email.trim(),
        token: code.trim(),
      });
      this.save({
        accessToken: r.access_token,
        refreshToken: r.refresh_token,
        expiresAt: Date.now() + r.expires_in * 1000,
        email: r.user?.email ?? email,
      });
      return true;
    } catch {
      return false;
    }
  }

  async signOut(): Promise<void> {
    window.localStorage.removeItem(DEVICE_SESSION_KEY);
    const s = this.load();
    window.localStorage.removeItem(SESSION_KEY);
    if (s) await fetch(`${this.url}/auth/v1/logout`, { method: "POST", headers: this.headers(s.accessToken) }).catch(() => undefined);
  }

  async outlets(): Promise<Outlet[]> {
    const r = await this.rpc<{ outlets: Outlet[] }>("admin_me", {});
    return r.outlets;
  }

  menu(outletId: string): Promise<AdminMenu> {
    return this.rpc("admin_menu", { p_outlet: outletId });
  }

  priceHistory(outletId: string, refId: string): Promise<PricePoint[]> {
    return this.rpc("admin_price_history", { p_outlet: outletId, p_ref: refId });
  }

  saveCategory(outletId: string, c: Parameters<AdminStore["saveCategory"]>[1]): Promise<string> {
    return this.rpc("admin_save_category", { p_outlet: outletId, p_id: c.id, p_name: c.name, p_sort: c.sort, p_active: c.active });
  }

  saveItem(outletId: string, i: Parameters<AdminStore["saveItem"]>[1]): Promise<string> {
    return this.rpc("admin_save_item", {
      p_outlet: outletId,
      p_id: i.id,
      p_category: i.categoryId,
      p_name: i.name,
      p_batch_cooked: i.batchCooked,
      p_sort: i.sort,
      p_active: i.active,
      p_modifier_ids: i.modifierIds,
    });
  }

  saveVariant(outletId: string, v: Parameters<AdminStore["saveVariant"]>[1]): Promise<string> {
    return this.rpc("admin_save_variant", {
      p_outlet: outletId,
      p_id: v.id,
      p_item: v.itemId,
      p_name: v.name,
      p_sort: v.sort,
      p_active: v.active,
      p_price_paise: v.pricePaise,
      p_cost_paise: v.costPaise,
    });
  }

  saveModifier(outletId: string, m: Parameters<AdminStore["saveModifier"]>[1]): Promise<string> {
    return this.rpc("admin_save_modifier", {
      p_outlet: outletId,
      p_id: m.id,
      p_name: m.name,
      p_active: m.active,
      p_price_paise: m.pricePaise,
      p_cost_paise: m.costPaise,
    });
  }

  saveCombo(outletId: string, c: Parameters<AdminStore["saveCombo"]>[1]): Promise<string> {
    return this.rpc("admin_save_combo", {
      p_outlet: outletId,
      p_id: c.id,
      p_name: c.name,
      p_description: c.description,
      p_active: c.active,
      p_price_paise: c.pricePaise,
      p_cost_paise: c.costPaise,
      p_parts: c.parts,
    });
  }

  async setFavourites(outletId: string, ids: string[]): Promise<void> {
    await this.rpc("admin_set_favourites", { p_outlet: outletId, p_ids: ids });
  }

  async facts(outletId: string, from: string, to: string): Promise<Facts> {
    const r = await this.rpc<{
      days: Facts["days"];
      orders: OrderRow[];
      expenses: [string, string, number, "cash" | "upi", number][];
      movements: [string, "in" | "out", number][];
      stockOuts: [string, number][];
    }>("admin_facts", { p_outlet: outletId, p_from: from, p_to: to });
    return {
      days: r.days,
      orders: r.orders.map((o) => ({
        id: o[0],
        at: o[1] * 1000,
        dayId: o[2],
        staff: o[3],
        channel: o[4],
        subtotal: o[5],
        discount: o[6],
        total: o[7],
        cash: o[8],
        upi: o[9],
        voided: o[10],
        voidedBy: o[11],
        lines: (o[12] ?? []).map((l) => ({ refId: l[0], kind: l[1], qty: l[2], total: l[3], cost: l[4] })),
      })),
      expenses: r.expenses.map((e) => ({ dayId: e[0], category: e[1], amount: e[2], method: e[3], at: e[4] * 1000 })),
      movements: r.movements.map((m) => ({ dayId: m[0], direction: m[1], amount: m[2] })),
      stockOuts: r.stockOuts.map((s) => ({ refId: s[0], at: s[1] * 1000 })),
    };
  }

  // ---------------------------------------------------------------- plumbing

  /** After clicking the email link, Supabase sends the browser back with the tokens in the URL hash. */
  private captureLinkSignIn(): void {
    if (typeof window === "undefined" || !window.location.hash.includes("access_token=")) return;
    const p = new URLSearchParams(window.location.hash.slice(1));
    const access = p.get("access_token");
    const refresh = p.get("refresh_token");
    if (access && refresh) {
      this.save({
        accessToken: access,
        refreshToken: refresh,
        expiresAt: Date.now() + Number(p.get("expires_in") ?? 3600) * 1000,
        email: emailFromJwt(access),
      });
    }
    window.history.replaceState(null, "", window.location.pathname);
  }

  private loadDevice(): DeviceSession | null {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(DEVICE_SESSION_KEY) : null;
      return raw ? (JSON.parse(raw) as DeviceSession) : null;
    } catch {
      return null;
    }
  }

  /** Calls a function as the app itself (no user sign-in). */
  private async anonRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: this.anonHeaders(), body: JSON.stringify(args) });
    } catch {
      throw new Error(`Can't reach the Supabase server at ${this.url}.`);
    }
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (body?.code === "PGRST202" || res.status === 404) {
      throw new Error("The database is missing the latest update. In Supabase → SQL Editor, run the newest file in supabase/migrations.");
    }
    if (!res.ok) throw new Error(body?.message ?? `Server error (${res.status}).`);
    return body as T;
  }

  private anonHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      apikey: this.anonKey,
      ...(this.anonKey.startsWith("eyJ") ? { Authorization: `Bearer ${this.anonKey}` } : {}),
    };
  }

  private load(): AuthSession | null {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as AuthSession) : null;
    } catch {
      return null;
    }
  }

  private save(s: AuthSession): void {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  }

  private async session(): Promise<AuthSession | null> {
    const s = this.load();
    if (!s) return null;
    if (s.expiresAt - Date.now() > 60_000) return s;
    try {
      const r = await this.auth<{ access_token: string; refresh_token: string; expires_in: number }>(
        "token?grant_type=refresh_token",
        { refresh_token: s.refreshToken },
      );
      const next = { ...s, accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: Date.now() + r.expires_in * 1000 };
      this.save(next);
      return next;
    } catch {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  private headers(token?: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      apikey: this.anonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  private async auth<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.url}/auth/v1/${path}`, { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.msg ?? json.error_description ?? json.message ?? "Sign-in failed.");
    return json as T;
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const device = this.loadDevice();
    if (device) {
      try {
        return await this.anonRpc<T>(fn, { ...args, p_session: device.session });
      } catch (e) {
        // Device sessions last 16 hours: sign in again with the saved key once, then retry.
        if (e instanceof Error && /log in again|sign in/i.test(e.message) && (await this.signInWithDevice(device.key).catch(() => false))) {
          return this.anonRpc<T>(fn, { ...args, p_session: this.loadDevice()!.session });
        }
        throw e;
      }
    }
    const s = await this.session();
    if (!s) throw new Error("Please sign in again.");
    let res: Response;
    try {
      res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: this.headers(s.accessToken), body: JSON.stringify(args) });
    } catch {
      throw new Error(
        `Can't reach the Supabase server at ${this.url}. If your internet works, check that the URL setting in Vercel is your Supabase Project URL (https://….supabase.co), then redeploy.`,
      );
    }
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (body?.code === "PGRST202" || res.status === 404) {
      throw new Error("Connected to Supabase, but the database isn't set up yet. Run the SQL setup files listed in the README in Supabase → SQL Editor.");
    }
    if (!res.ok) throw new Error(body?.message ?? `Server error (${res.status}).`);
    return body as T;
  }
}

function emailFromJwt(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.email ?? "";
  } catch {
    return "";
  }
}
