import type { Combo, LineModifier, Menu, Modifier, OrderLine, Paise, Payment, Variant } from "./types";

export type Sellable =
  | { kind: "variant"; id: string; title: string; subtitle: string; pricePaise: Paise; variant: Variant }
  | { kind: "combo"; id: string; title: string; subtitle: string; pricePaise: Paise; combo: Combo };

export function findSellable(menu: Menu, id: string): Sellable | null {
  const variant = menu.variants.find((v) => v.id === id);
  if (variant) {
    const item = menu.items.find((i) => i.id === variant.itemId);
    return {
      kind: "variant",
      id,
      title: item?.name ?? "Item",
      subtitle: variant.name,
      pricePaise: variant.pricePaise,
      variant,
    };
  }
  const combo = menu.combos.find((c) => c.id === id);
  if (combo) {
    return { kind: "combo", id, title: combo.name, subtitle: combo.description, pricePaise: combo.pricePaise, combo };
  }
  return null;
}

/** Name printed on the bill, e.g. "Veg Momos Steamed Full". */
export function lineName(s: Sellable): string {
  if (s.kind === "combo") return s.title;
  return `${s.title} ${s.subtitle.replace(/\s*·\s*/g, " ")}`;
}

export function newLine(s: Sellable, key: string, modifiers: Modifier[] = []): OrderLine {
  return {
    key,
    kind: s.kind,
    refId: s.id,
    name: lineName(s),
    qty: 1,
    unitPricePaise: s.pricePaise,
    unitCostPaise: s.kind === "variant" ? s.variant.costPaise : s.combo.costPaise,
    modifiers: modifiers.map(toLineModifier),
  };
}

export function toLineModifier(m: Modifier): LineModifier {
  return { modifierId: m.id, name: m.name, pricePaise: m.pricePaise, costPaise: m.costPaise };
}

/** Adding the same thing twice bumps qty instead of adding a second line. */
export function addToCart(lines: OrderLine[], s: Sellable, key: string, modifiers: Modifier[] = []): OrderLine[] {
  const sig = signature(s.id, modifiers.map((m) => m.id));
  const idx = lines.findIndex((l) => signature(l.refId, l.modifiers.map((m) => m.modifierId)) === sig);
  if (idx >= 0) return lines.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l));
  return [...lines, newLine(s, key, modifiers)];
}

export function changeQty(lines: OrderLine[], key: string, delta: number): OrderLine[] {
  return lines
    .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
    .filter((l) => l.qty > 0);
}

export function setLineModifiers(lines: OrderLine[], key: string, modifiers: Modifier[]): OrderLine[] {
  return lines.map((l) => (l.key === key ? { ...l, modifiers: modifiers.map(toLineModifier) } : l));
}

export function lineUnitPaise(l: OrderLine): Paise {
  return l.unitPricePaise + l.modifiers.reduce((s, m) => s + m.pricePaise, 0);
}

export function lineTotalPaise(l: OrderLine): Paise {
  return lineUnitPaise(l) * l.qty;
}

export function subtotalPaise(lines: OrderLine[]): Paise {
  return lines.reduce((s, l) => s + lineTotalPaise(l), 0);
}

/** Discount can never take the total below zero. */
export function totalPaise(lines: OrderLine[], discountPaise: Paise): Paise {
  return Math.max(0, subtotalPaise(lines) - Math.max(0, discountPaise));
}

export function itemCount(lines: OrderLine[]): number {
  return lines.reduce((s, l) => s + l.qty, 0);
}

/**
 * Build payments for a bill. For a split, cashPaise is the cash part and the rest is UPI.
 * cashReceived is optional and only used to show change.
 */
export function buildPayments(
  total: Paise,
  mode: "cash" | "upi" | "split",
  opts: { cashPartPaise?: Paise; cashReceivedPaise?: Paise | null } = {},
): Payment[] {
  if (mode === "upi") return [{ method: "upi", amountPaise: total, cashReceivedPaise: null }];
  if (mode === "cash") {
    return [{ method: "cash", amountPaise: total, cashReceivedPaise: opts.cashReceivedPaise ?? null }];
  }
  const cash = Math.min(total, Math.max(0, opts.cashPartPaise ?? 0));
  const payments: Payment[] = [];
  if (cash > 0) payments.push({ method: "cash", amountPaise: cash, cashReceivedPaise: opts.cashReceivedPaise ?? null });
  if (total - cash > 0) payments.push({ method: "upi", amountPaise: total - cash, cashReceivedPaise: null });
  return payments;
}

export function changeDuePaise(payments: Payment[]): Paise {
  const cash = payments.find((p) => p.method === "cash");
  if (!cash || cash.cashReceivedPaise == null) return 0;
  return Math.max(0, cash.cashReceivedPaise - cash.amountPaise);
}

function signature(refId: string, modifierIds: string[]): string {
  return `${refId}|${[...modifierIds].sort().join(",")}`;
}
