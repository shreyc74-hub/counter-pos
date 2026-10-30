"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addToCart,
  buildPayments,
  changeDuePaise,
  changeQty,
  findSellable,
  itemCount,
  lineTotalPaise,
  type Sellable,
  setLineModifiers,
  subtotalPaise,
  totalPaise,
} from "@/lib/domain/cart";
import { formatRupees, rupeesToPaise } from "@/lib/domain/money";
import { loadCart, saveCart } from "@/lib/domain/savedCart";
import type { Channel, Discount, Menu, Modifier, OrderLine, Outlet, Payment, Service, Staff } from "@/lib/domain/types";
import { uuid } from "@/lib/uuid";
import type { OwnerApproval } from "@/lib/data/store";
import { PinPad, Sheet, errorText } from "./ui";

export interface OrderDraft {
  lines: OrderLine[];
  discount: Discount | null;
  channel: Channel;
  service: Service | null;
  externalOrderId: string | null;
  note: string | null;
  /** Dine in only: save the bill now, take payment after the meal (from Orders today). */
  payLater: boolean;
}

interface Props {
  menu: Menu;
  outlet: Outlet;
  staff: Staff;
  soldOut: Set<string>;
  nextToken: number | null;
  /** Dish photos by item id (only dishes that have one). */
  photos?: Record<string, string>;
  onToggleSoldOut: (sellableId: string, soldOut: boolean) => void;
  approveAsOwner: (pin: string) => Promise<OwnerApproval | null>;
  /** Saves the bill. Resolves once it is stored. */
  onSubmit: (draft: OrderDraft, payments: Payment[]) => Promise<boolean>;
  notify: (msg: string) => void;
}

type Tab = { id: string; label: string };

const DISCOUNT_REASONS = ["Staff meal", "Regular customer", "Complaint", "Other"];

export function OrderScreen(props: Props) {
  const { menu, soldOut } = props;
  // A refresh mid-order keeps the cart (restored from this device, checked against the menu).
  const [restored] = useState(() => loadCart(menu));
  const [lines, setLines] = useState<OrderLine[]>(restored?.lines ?? []);
  const [discount, setDiscount] = useState<Discount | null>(restored?.discount ?? null);
  const [channel, setChannel] = useState<Channel>(restored?.channel ?? "counter");
  const [service, setService] = useState<Service | null>(restored?.service ?? null);
  // Phones and portrait tablets: the cart opens as a panel from the order bar (see pos-layout.css).
  const [cartOpen, setCartOpen] = useState(false);
  const [externalId, setExternalId] = useState(restored?.externalId ?? "");
  const [note, setNote] = useState<string | null>(restored?.note ?? null);
  useEffect(() => saveCart({ lines, discount, channel, service, externalId, note }), [lines, discount, channel, service, externalId, note]);
  const [markMode, setMarkMode] = useState(false);
  const [lineSheet, setLineSheet] = useState<OrderLine | null>(null);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [showCash, setShowCash] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sections down the side, in the menu's order (like the old POS). Favourites and combos
  // only appear when the menu has some.
  const tabs: Tab[] = useMemo(
    () => [
      ...(menu.favourites.length ? [{ id: "fav", label: "Favourites" }] : []),
      ...[...menu.categories].sort((a, b) => a.sort - b.sort).map((c) => ({ id: c.id, label: c.name })),
      ...(menu.combos.some((c) => c.active) ? [{ id: "combos", label: "Combos" }] : []),
    ],
    [menu],
  );
  const [tab, setTab] = useState<string>(() => tabs[0]?.id ?? "");

  const subtotal = subtotalPaise(lines);
  const total = totalPaise(lines, discount?.amountPaise ?? 0);

  const add = (s: Sellable, modifiers: Modifier[] = []) => {
    if (soldOut.has(s.id)) {
      props.notify(`${s.title} ${s.kind === "variant" ? s.subtitle : ""} is sold out. Long-press to bring it back.`);
      return;
    }
    setLines((ls) => addToCart(ls, s, uuid(), modifiers));
  };

  const clear = () => {
    setLines([]);
    setDiscount(null);
    setNote(null);
    setChannel("counter");
    setService(null);
    setExternalId("");
  };

  // Counter orders must say dine in or takeaway before payment (delivery orders don't).
  const needService = channel === "counter" && !service;

  /** No payments = "Not paid" (dine in only). */
  const submit = async (payments: Payment[]) => {
    if (!lines.length || saving) return;
    setSaving(true);
    try {
      const ok = await props.onSubmit(
        {
          lines,
          discount: discount && discount.amountPaise > 0 ? discount : null,
          channel,
          service: channel === "counter" ? service : null,
          externalOrderId: channel === "swiggy" || channel === "zomato" ? externalId.trim() || null : null,
          note,
          payLater: payments.length === 0,
        },
        payments,
      );
      if (ok) {
        clear();
        setShowCash(false);
        setCartOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="order">
      <nav className="cat-list" aria-label="Menu sections">
        {tabs.map((t) => (
          <button key={t.id} type="button" className="cat" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        <button type="button" className="cat cat-tool" aria-pressed={markMode} onClick={() => setMarkMode((m) => !m)}>
          {markMode ? "Done marking" : "Mark sold out"}
        </button>
      </nav>

      <div className="menu-pane">
        {markMode ? (
          <div className="notice small">Tap a tile to mark it sold out or back in stock. Long-press a tile also works any time.</div>
        ) : null}
        <TileGrid
          menu={menu}
          tab={tab}
          soldOut={soldOut}
          markMode={markMode}
          photos={props.photos ?? {}}
          onTapSellable={(s) => (markMode ? props.onToggleSoldOut(s.id, !soldOut.has(s.id)) : add(s))}
          onLongPressSellable={(s) => props.onToggleSoldOut(s.id, !soldOut.has(s.id))}
        />
      </div>

      {/* Phones and portrait tablets: what's in the order so far, and the way into the cart. */}
      <div className="order-bar">
        <span className="order-bar-summary">
          {lines.length ? (
            <>
              <strong>{formatRupees(total)}</strong> · {itemCount(lines)} item{itemCount(lines) === 1 ? "" : "s"}
            </>
          ) : (
            "No items added yet"
          )}
        </span>
        <ServiceToggle value={service} onChange={setService} disabled={channel !== "counter"} />
        <button type="button" className="btn btn-confirm" disabled={!lines.length} onClick={() => setCartOpen(true)}>
          Confirm order
        </button>
      </div>

      {cartOpen ? <div className="cart-backdrop" onClick={() => setCartOpen(false)} /> : null}
      <aside className={`cart${cartOpen ? " open" : ""}`} aria-label="Current order">
        <div className="cart-head">
          <div className="stack" style={{ gap: 2 }}>
            <strong style={{ fontSize: 20 }}>{props.nextToken ? `Token ${props.nextToken}` : "New order"}</strong>
            <span className="small muted">
              {itemCount(lines)} item{itemCount(lines) === 1 ? "" : "s"}
            </span>
          </div>
          <button type="button" className="btn cart-close" onClick={() => setCartOpen(false)}>
            Add more
          </button>
          <label className="field small order-type" style={{ fontWeight: 500 }}>
            Order type
            <select
              className="input"
              style={{ minHeight: 44, fontSize: 15, width: 130 }}
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel)}
            >
              <option value="counter">Counter</option>
              <option value="swiggy">Swiggy</option>
              <option value="zomato">Zomato</option>
              <option value="phone">Phone</option>
            </select>
          </label>
        </div>
        {channel === "swiggy" || channel === "zomato" ? (
          <div style={{ padding: "8px 16px 0" }}>
            <label className="field small">
              {channel === "swiggy" ? "Swiggy" : "Zomato"} order ID (optional)
              <input className="input" style={{ minHeight: 44, fontSize: 16 }} value={externalId} onChange={(e) => setExternalId(e.target.value)} />
            </label>
          </div>
        ) : null}
        {channel === "counter" ? (
          <div className="cart-service">
            <ServiceToggle value={service} onChange={setService} />
          </div>
        ) : null}

        <div className="cart-lines">
          {lines.length === 0 ? <div className="empty-cart">Tap items to start an order</div> : null}
          {lines.map((l) => (
            <div key={l.key} className="cart-line">
              <div className="cart-line-top">
                <button
                  type="button"
                  onClick={() => (l.kind === "variant" ? setLineSheet(l) : undefined)}
                  style={{ border: "none", background: "none", padding: 0, textAlign: "left", fontWeight: 600, fontSize: 16 }}
                  aria-label={l.kind === "variant" ? `${l.name}, change add-ons` : l.name}
                >
                  {l.name}
                </button>
                <span>{formatRupees(lineTotalPaise(l))}</span>
              </div>
              <div className="row between">
                <SpiceChips
                  menu={menu}
                  line={l}
                  onChange={(mods) => setLines((ls) => setLineModifiers(ls, l.key, mods))}
                  onMore={() => setLineSheet(l)}
                />
                <span className="qty">
                  <button type="button" aria-label={`One less ${l.name}`} onClick={() => setLines((ls) => changeQty(ls, l.key, -1))}>
                    −
                  </button>
                  <strong style={{ minWidth: 20, textAlign: "center" }}>{l.qty}</strong>
                  <button type="button" aria-label={`One more ${l.name}`} onClick={() => setLines((ls) => changeQty(ls, l.key, 1))}>
                    +
                  </button>
                </span>
              </div>
            </div>
          ))}
          {note ? <div className="small muted" style={{ padding: "8px 0" }}>Note: {note}</div> : null}
        </div>

        <div className="cart-foot">
          <div className="row">
            <button type="button" className="btn grow" disabled={!lines.length} onClick={() => setShowDiscount(true)}>
              {discount ? `Discount −${formatRupees(discount.amountPaise)}` : "Discount"}
            </button>
            <button type="button" className="btn grow" onClick={() => setShowNote(true)}>
              Note
            </button>
            <button type="button" className="btn grow" disabled={!lines.length} onClick={clear}>
              Clear
            </button>
          </div>
          {discount ? (
            <div className="row between small muted">
              <span>Subtotal {formatRupees(subtotal)}</span>
              <span>
                {discount.reason}
                {discount.approvedBy ? ` · approved by ${discount.approvedBy}` : ""}
              </span>
            </div>
          ) : null}
          <div className="total">
            <span style={{ fontSize: 18, fontWeight: 600 }}>Total</span>
            <strong>{formatRupees(total)}</strong>
          </div>
          {needService && lines.length ? <div className="notice small">Choose Dine in or Takeaway to take payment.</div> : null}
          <div className="pay">
            <button type="button" className="btn btn-cash" disabled={!lines.length || saving || needService} onClick={() => setShowCash(true)}>
              CASH
            </button>
            <button
              type="button"
              className="btn btn-upi"
              disabled={!lines.length || saving || needService}
              onClick={() => void submit(buildPayments(total, "upi"))}
            >
              UPI
            </button>
          </div>
          {channel === "counter" && service === "dine_in" ? (
            <button type="button" className="btn btn-big btn-unpaid" disabled={!lines.length || saving} onClick={() => void submit([])}>
              NOT PAID · pay after eating
            </button>
          ) : null}
        </div>
      </aside>

      {lineSheet ? (
        <ModifierSheet
          menu={menu}
          line={lineSheet}
          onClose={() => setLineSheet(null)}
          onSave={(mods) => {
            setLines((ls) => setLineModifiers(ls, lineSheet.key, mods));
            setLineSheet(null);
          }}
        />
      ) : null}

      {showDiscount ? (
        <DiscountSheet
          subtotal={subtotal}
          staff={props.staff}
          limit={props.outlet.cashierDiscountLimitPaise}
          current={discount}
          approveAsOwner={props.approveAsOwner}
          onClose={() => setShowDiscount(false)}
          onApply={(d) => {
            setDiscount(d);
            setShowDiscount(false);
          }}
        />
      ) : null}

      {showNote ? (
        <NoteSheet
          value={note ?? ""}
          onClose={() => setShowNote(false)}
          onSave={(v) => {
            setNote(v.trim() || null);
            setShowNote(false);
          }}
        />
      ) : null}

      {showCash ? (
        <CashSheet total={total} saving={saving} onClose={() => setShowCash(false)} onDone={(payments) => void submit(payments)} />
      ) : null}
    </div>
  );
}

function TileGrid({
  menu,
  tab,
  soldOut,
  markMode,
  photos,
  onTapSellable,
  onLongPressSellable,
}: {
  menu: Menu;
  tab: string;
  soldOut: Set<string>;
  markMode: boolean;
  photos: Record<string, string>;
  onTapSellable: (s: Sellable) => void;
  onLongPressSellable: (s: Sellable) => void;
}) {
  // One tile per option, so each tap adds straight to the order: a dish with Half and Full
  // fills one row (Half on the left), like the old POS.
  let ids: string[];
  if (tab === "fav") ids = menu.favourites;
  else if (tab === "combos") ids = menu.combos.filter((c) => c.active).map((c) => c.id);
  else
    ids = menu.items
      .filter((i) => i.categoryId === tab)
      .sort((a, b) => a.sort - b.sort)
      .flatMap((i) =>
        menu.variants
          .filter((v) => v.itemId === i.id && v.active)
          .sort((a, b) => a.sort - b.sort)
          .map((v) => v.id),
      );
  const sellables = ids.map((id) => findSellable(menu, id)).filter((s): s is Sellable => !!s);
  if (!sellables.length) return <p className="muted">Nothing in this section yet.</p>;
  return (
    <div className="tiles">
      {sellables.map((s) => (
        <PressTile
          key={s.id}
          title={s.title}
          subtitle={s.subtitle}
          price={formatRupees(s.pricePaise)}
          photo={s.kind === "variant" ? photos[s.variant.itemId] : undefined}
          soldOut={soldOut.has(s.id)}
          marking={markMode}
          onTap={() => onTapSellable(s)}
          onLongPress={() => onLongPressSellable(s)}
        />
      ))}
    </div>
  );
}

/** Dine in / takeaway: one tap each, required for counter orders. */
function ServiceToggle({ value, onChange, disabled }: { value: Service | null; onChange: (v: Service) => void; disabled?: boolean }) {
  return (
    <div className="service-toggle" role="group" aria-label="Dine in or takeaway">
      {(
        [
          ["dine_in", "Dine in"],
          ["takeaway", "Takeaway"],
        ] as [Service, string][]
      ).map(([v, label]) => (
        <button key={v} type="button" aria-pressed={value === v} disabled={disabled} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

const SPICE = /^(less|extra|more) spicy$/i;

/** One-tap Less spicy / Extra spicy on a cart line (only one at a time); other add-ons via a sheet. */
function SpiceChips({
  menu,
  line,
  onChange,
  onMore,
}: {
  menu: Menu;
  line: OrderLine;
  onChange: (mods: Modifier[]) => void;
  onMore: () => void;
}) {
  const variant = line.kind === "variant" ? menu.variants.find((v) => v.id === line.refId) : undefined;
  const item = menu.items.find((i) => i.id === variant?.itemId);
  const allowed = (item?.modifierIds ?? []).map((id) => menu.modifiers.find((m) => m.id === id)).filter((m): m is Modifier => !!m);
  const spice = allowed.filter((m) => SPICE.test(m.name));
  const others = allowed.filter((m) => !SPICE.test(m.name));
  const current = line.modifiers.map((lm) => menu.modifiers.find((m) => m.id === lm.modifierId)).filter((m): m is Modifier => !!m);
  const otherPicked = line.modifiers.filter((m) => !SPICE.test(m.name));
  return (
    <span className="spice">
      {spice.map((m) => {
        const on = line.modifiers.some((x) => x.modifierId === m.id);
        return (
          <button
            key={m.id}
            type="button"
            className="chip chip-small"
            aria-pressed={on}
            onClick={() => onChange(on ? current.filter((x) => x.id !== m.id) : [...current.filter((x) => !SPICE.test(x.name)), m])}
          >
            {m.name}
          </button>
        );
      })}
      {others.length ? (
        <button type="button" className="chip chip-small" onClick={onMore}>
          {otherPicked.length ? otherPicked.map((m) => `+ ${m.name}`).join(", ") : "+ More"}
        </button>
      ) : null}
    </span>
  );
}

/** A tile that adds on tap and toggles sold out on a long press (600 ms). */
function PressTile(props: {
  title: string;
  subtitle: string;
  price: string;
  photo?: string;
  soldOut: boolean;
  marking: boolean;
  onTap: () => void;
  onLongPress: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const start = () => {
    longPressed.current = false;
    timer.current = setTimeout(() => {
      longPressed.current = true;
      props.onLongPress();
    }, 600);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <button
      type="button"
      className={`tile${props.soldOut ? " soldout" : ""}${props.marking ? " marking" : ""}`}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (longPressed.current) return;
        props.onTap();
      }}
    >
      {props.photo ? <img className="tile-photo" src={props.photo} alt="" draggable={false} /> : null}
      <span className="stack" style={{ gap: 4 }}>
        <span className="tile-name">{props.title}</span>
        {props.subtitle ? <span className="tile-sub">{props.subtitle}</span> : null}
      </span>
      <span className="tile-foot">
        <span className="tile-price">{props.price}</span>
        <span className="tile-flag">{props.soldOut ? "SOLD OUT" : ""}</span>
      </span>
    </button>
  );
}

function ModifierSheet({
  menu,
  line,
  onClose,
  onSave,
}: {
  menu: Menu;
  line: OrderLine;
  onClose: () => void;
  onSave: (mods: Modifier[]) => void;
}) {
  const variant = menu.variants.find((v) => v.id === line.refId);
  const item = menu.items.find((i) => i.id === variant?.itemId);
  const modifiers = (item?.modifierIds ?? []).map((id) => menu.modifiers.find((m) => m.id === id)).filter((m): m is Modifier => !!m);
  const [picked, setPicked] = useState<string[]>(line.modifiers.map((m) => m.modifierId));
  return (
    <Sheet title={`Add-ons · ${line.name}`} onClose={onClose}>
      {modifiers.length === 0 ? <p className="muted">No add-ons for this item.</p> : null}
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {modifiers.map((m) => (
          <button
            key={m.id}
            type="button"
            className="chip"
            aria-pressed={picked.includes(m.id)}
            onClick={() => setPicked((x) => (x.includes(m.id) ? x.filter((y) => y !== m.id) : [...x, m.id]))}
          >
            {m.name}
            {m.pricePaise ? ` +${formatRupees(m.pricePaise)}` : ""}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-dark btn-big" onClick={() => onSave(modifiers.filter((m) => picked.includes(m.id)))}>
        Save add-ons
      </button>
    </Sheet>
  );
}

function DiscountSheet({
  subtotal,
  staff,
  limit,
  current,
  approveAsOwner,
  onClose,
  onApply,
}: {
  subtotal: number;
  staff: Staff;
  limit: number;
  current: Discount | null;
  approveAsOwner: (pin: string) => Promise<OwnerApproval | null>;
  onClose: () => void;
  onApply: (d: Discount | null) => void;
}) {
  const [amountText, setAmountText] = useState(current ? String(current.amountPaise / 100) : "");
  const [reason, setReason] = useState(current?.reason ?? "");
  const [needPin, setNeedPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const amount = Math.min(subtotal, rupeesToPaise(amountText) ?? 0);
  const quick = [
    { label: "₹10", paise: 1000 },
    { label: "₹20", paise: 2000 },
    { label: "10%", paise: Math.round(subtotal / 10 / 100) * 100 },
    { label: "Free (100%)", paise: subtotal },
  ];
  const valid = amount > 0 && reason.trim().length > 0;
  const apply = () => {
    if (!valid) return;
    if (staff.role !== "owner" && amount > limit) {
      setNeedPin(true);
      return;
    }
    onApply({ amountPaise: amount, reason: reason.trim(), approvedBy: null });
  };
  if (needPin) {
    return (
      <Sheet title="Owner approval needed" onClose={onClose}>
        <p className="muted">
          Discounts above {formatRupees(limit)} need the owner&apos;s PIN.
        </p>
        <div style={{ maxWidth: 380, margin: "0 auto", width: "100%" }}>
          <PinPad
            light
            error={pinError}
            onSubmit={async (pin) => {
              try {
                const ok = await approveAsOwner(pin);
                if (!ok) return setPinError("That is not the owner PIN.");
                onApply({ amountPaise: amount, reason: reason.trim(), approvedBy: ok.name, approvalToken: ok.approvalToken });
              } catch (e) {
                setPinError(errorText(e));
              }
            }}
          />
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title="Discount" onClose={onClose}>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {quick.map((q) => (
          <button key={q.label} type="button" className="chip" onClick={() => setAmountText(String(q.paise / 100))}>
            {q.label}
          </button>
        ))}
      </div>
      <label className="field">
        Amount (₹)
        <input className="input input-big" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
      </label>
      <div className="stack" style={{ gap: 8 }}>
        <span className="field">Reason (required)</span>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {DISCOUNT_REASONS.map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>
      {staff.role !== "owner" && amount > limit ? (
        <div className="notice small">More than {formatRupees(limit)}: the owner&apos;s PIN will be needed.</div>
      ) : null}
      <div className="row">
        {current ? (
          <button type="button" className="btn grow" onClick={() => onApply(null)}>
            Remove discount
          </button>
        ) : null}
        <button type="button" className="btn btn-dark btn-big grow" disabled={!valid} onClick={apply}>
          Apply {amount > 0 ? `−${formatRupees(amount)}` : ""}
        </button>
      </div>
    </Sheet>
  );
}

function NoteSheet({ value, onClose, onSave }: { value: string; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const presets = ["Less spicy", "No onion", "Pack separately", "Extra chutney"];
  return (
    <Sheet title="Order note" onClose={onClose}>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {presets.map((p) => (
          <button key={p} type="button" className="chip" onClick={() => setV((x) => (x ? `${x}, ${p}` : p))}>
            {p}
          </button>
        ))}
      </div>
      <label className="field">
        Note
        <input className="input" value={v} onChange={(e) => setV(e.target.value)} maxLength={120} />
      </label>
      <button type="button" className="btn btn-dark btn-big" onClick={() => onSave(v)}>
        Save note
      </button>
    </Sheet>
  );
}

function CashSheet({
  total,
  saving,
  onClose,
  onDone,
}: {
  total: number;
  saving: boolean;
  onClose: () => void;
  onDone: (payments: Payment[]) => void;
}) {
  const [received, setReceived] = useState<number | null>(null);
  const [otherText, setOtherText] = useState("");
  const [split, setSplit] = useState(false);
  const [cashPartText, setCashPartText] = useState("");
  const notes = [10000, 20000, 50000].filter((n) => n >= total);
  const cashPart = split ? Math.min(total, rupeesToPaise(cashPartText) ?? 0) : total;
  const receivedPaise = received ?? (otherText ? rupeesToPaise(otherText) : null);
  const payments = split
    ? buildPayments(total, "split", { cashPartPaise: cashPart, cashReceivedPaise: receivedPaise })
    : buildPayments(total, "cash", { cashReceivedPaise: receivedPaise });
  const change = changeDuePaise(payments);
  const short = receivedPaise != null && receivedPaise < cashPart;
  return (
    <Sheet title={split ? "Split cash + UPI" : "Cash payment"} onClose={onClose}>
      <div className="total" style={{ padding: "16px 20px", background: "var(--ground)", borderRadius: 14 }}>
        <span style={{ fontSize: 18, fontWeight: 600 }}>To pay</span>
        <strong>{formatRupees(total)}</strong>
      </div>
      {split ? (
        <label className="field">
          Cash part (₹). The rest is UPI.
          <input className="input input-big" inputMode="decimal" value={cashPartText} onChange={(e) => setCashPartText(e.target.value)} />
          {cashPart > 0 && cashPart < total ? (
            <span className="small muted">
              Cash {formatRupees(cashPart)} + UPI {formatRupees(total - cashPart)}
            </span>
          ) : null}
        </label>
      ) : null}
      <div className="stack" style={{ gap: 8 }}>
        <span className="field">Cash received (optional, for change)</span>
        <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
          <button type="button" className="chip" aria-pressed={received === cashPart} onClick={() => { setReceived(cashPart); setOtherText(""); }}>
            Exact
          </button>
          {notes.map((n) => (
            <button key={n} type="button" className="chip" aria-pressed={received === n} onClick={() => { setReceived(n); setOtherText(""); }}>
              {formatRupees(n)}
            </button>
          ))}
          <input
            className="input"
            style={{ width: 140, minHeight: 44 }}
            inputMode="decimal"
            placeholder="Other ₹"
            aria-label="Other amount received"
            value={otherText}
            onChange={(e) => {
              setOtherText(e.target.value);
              setReceived(null);
            }}
          />
        </div>
      </div>
      {change > 0 ? (
        <div className="total notice">
          <span style={{ fontSize: 18, fontWeight: 600 }}>Give change</span>
          <strong style={{ color: "var(--cash-dark)" }}>{formatRupees(change)}</strong>
        </div>
      ) : null}
      {short ? <div className="error small">Received is less than the cash amount.</div> : null}
      <div className="row">
        <button type="button" className="btn btn-big grow" aria-pressed={split} onClick={() => setSplit((s) => !s)}>
          {split ? "All cash" : "Split cash + UPI"}
        </button>
        <button
          type="button"
          className="btn btn-cash btn-big grow"
          style={{ flexGrow: 2 }}
          disabled={saving || short || (split && (cashPart <= 0 || cashPart >= total))}
          onClick={() => onDone(payments)}
        >
          {saving ? "Saving…" : "Done · save bill"}
        </button>
      </div>
    </Sheet>
  );
}
