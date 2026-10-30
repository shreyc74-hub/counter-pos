import { changeDuePaise } from "@/lib/domain/cart";
import { formatAmount } from "@/lib/domain/money";
import type { DaySession, DayTotals, Order, Outlet } from "@/lib/domain/types";

/**
 * One receipt layout drives both the on-screen preview and the printed ESC/POS bytes,
 * so what staff see is exactly what prints.
 */
export type ReceiptLine =
  | {
      kind: "text";
      text: string;
      align?: "left" | "center" | "right";
      bold?: boolean;
      big?: boolean;
      /** Double height, normal width: easier to read, still fits the line. */
      tall?: boolean;
      /**
       * 1¼× size, between normal text and the big title. Printers have no such size, so
       * it prints as a small picture of the text (see raster.ts); fits 4/5 of the characters.
       */
      medium?: boolean;
      /** Print only the first N characters bold (e.g. the item name, not its qty and amount). */
      boldChars?: number;
    }
  | { kind: "rule" }
  | { kind: "feed"; lines: number };

export interface ReceiptOptions {
  /** Characters per line: 32 for 58 mm paper, 48 for 80 mm. */
  width: 32 | 48;
  duplicate?: boolean;
  /** Item names on the bill: normal bold, medium (1¼×, the default) or large (double height). */
  itemSize?: ItemSize;
}

export type ItemSize = "normal" | "medium" | "large";

/** Characters that fit on a line of medium (1¼×) text: 25 on 58 mm paper (every dish name fits), 38 on 80 mm. */
export const mediumWidth = (width: number) => Math.floor((width * 4) / 5);

const CHANNEL_LABEL: Record<Order["channel"], string> = {
  counter: "Counter",
  swiggy: "Swiggy",
  zomato: "Zomato",
  phone: "Phone",
};

/** Printers only have Latin code pages: swap the rupee sign and other symbols for ASCII. */
export function toPrintable(s: string): string {
  return s
    .replace(/₹/g, "Rs ")
    .replace(/[·•]/g, "-")
    .replace(/[–—−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "");
}

export function twoCol(left: string, right: string, width: number): string {
  const l = toPrintable(left);
  const r = toPrintable(right);
  const space = width - r.length;
  if (l.length + 1 <= space) return l + " ".repeat(space - l.length) + r;
  return l.slice(0, Math.max(0, space - 1)) + " " + r;
}

function wrap(text: string, width: number): string[] {
  const words = toPrintable(text).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w.slice(0, width);
    else if (cur.length + 1 + w.length <= width) cur += " " + w;
    else {
      out.push(cur);
      cur = w.slice(0, width);
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`;
}

export function layoutReceipt(order: Order, outlet: Outlet, opts: ReceiptOptions): ReceiptLine[] {
  const W = opts.width;
  const qtyW = 3;
  const amtW = W === 32 ? 8 : 10;
  const nameW = W - qtyW - amtW - 2;
  const lines: ReceiptLine[] = [];
  const t = (text: string, extra: Partial<Extract<ReceiptLine, { kind: "text" }>> = {}) =>
    lines.push({ kind: "text", text: toPrintable(text), ...extra });

  t(outlet.name, { align: "center", bold: true, big: true });
  if (outlet.addressLine) wrap(outlet.addressLine, W).forEach((l) => t(l, { align: "center" }));
  if (outlet.phone) t(`Ph: ${outlet.phone}`, { align: "center" });
  if (opts.duplicate) t("DUPLICATE", { align: "center", bold: true });
  if (order.voided) t("*** VOID ***", { align: "center", bold: true });
  lines.push({ kind: "rule" });

  t(twoCol(`Bill: ${order.billNo}`, `Token: ${order.token}`, W));
  t(twoCol(formatDateTime(order.createdAt), CHANNEL_LABEL[order.channel], W));
  if (order.externalOrderId) t(`${CHANNEL_LABEL[order.channel]} ID: ${order.externalOrderId}`);
  t(`Staff: ${order.staffName}`);
  if (order.service) t(order.service === "dine_in" ? "DINE IN" : "TAKEAWAY", { align: "center", bold: true, big: true });
  lines.push({ kind: "rule" });

  const itemSize = opts.itemSize ?? "medium";
  if (itemSize !== "medium") t(row("Item", "Qty", "Amt", nameW, qtyW, amtW));
  for (const l of order.lines) {
    if (itemSize === "medium") {
      // Name in 1¼× bold on its own line, then "qty x price  amount" in normal text.
      for (const n of wrap(l.name, mediumWidth(W))) t(n, { bold: true, medium: true });
      t(twoCol(`  ${l.qty} x ${formatAmount(l.unitPricePaise)}`, formatAmount(l.unitPricePaise * l.qty), W));
    } else {
      // Name, qty and amount on one row; the name is bold (and double height when "large").
      const tall = itemSize === "large";
      const nameLines = wrap(l.name, nameW);
      t(row(nameLines[0], String(l.qty), formatAmount(l.unitPricePaise * l.qty), nameW, qtyW, amtW), { boldChars: nameW, tall });
      for (const extra of nameLines.slice(1)) t(extra, { bold: true, tall });
    }
    for (const m of l.modifiers) {
      const label = `  + ${m.name}`;
      t(m.pricePaise ? twoCol(label, formatAmount(m.pricePaise * l.qty), W) : toPrintable(label));
    }
  }
  if (order.note) wrap(`Note: ${order.note}`, W).forEach((l) => t(l));
  lines.push({ kind: "rule" });

  if (order.discount) {
    t(twoCol("Subtotal", formatAmount(order.subtotalPaise), W));
    t(twoCol(`Discount (${order.discount.reason})`, `-${formatAmount(order.discount.amountPaise)}`, W));
  }
  // Big text is double width, so it gets half the characters.
  t(twoCol("TOTAL", `Rs ${formatAmount(order.totalPaise)}`, W / 2), { bold: true, big: true });
  lines.push({ kind: "rule" });

  if (!order.payments.length) {
    t("NOT PAID", { align: "center", bold: true, big: true });
  } else {
    const paid = order.payments
      .map((p) => `${p.method === "cash" ? "Cash" : "UPI"} ${formatAmount(p.amountPaise)}`)
      .join(" + ");
    t(`Paid: ${paid}`);
  }
  const change = changeDuePaise(order.payments);
  if (change > 0) {
    const cash = order.payments.find((p) => p.method === "cash");
    t(twoCol(`Received ${formatAmount(cash?.cashReceivedPaise ?? 0)}`, `Change ${formatAmount(change)}`, W));
  }
  lines.push({ kind: "rule" });
  if (outlet.fssaiNo) t(`FSSAI: ${outlet.fssaiNo}`);
  if (outlet.receiptFooter) wrap(outlet.receiptFooter, W).forEach((l) => t(l, { align: "center" }));
  lines.push({ kind: "feed", lines: 3 });
  return lines;
}

export function layoutDayReport(
  day: DaySession,
  totals: DayTotals,
  outlet: Outlet,
  opts: Pick<ReceiptOptions, "width">,
): ReceiptLine[] {
  const W = opts.width;
  const lines: ReceiptLine[] = [];
  const t = (text: string, extra: Partial<Extract<ReceiptLine, { kind: "text" }>> = {}) =>
    lines.push({ kind: "text", text: toPrintable(text), ...extra });
  const kv = (k: string, paise: number) => t(twoCol(k, formatAmount(paise), W));

  t(outlet.name, { align: "center", bold: true, big: true });
  t("DAY REPORT", { align: "center", bold: true });
  t(day.businessDate, { align: "center" });
  lines.push({ kind: "rule" });
  t(twoCol("Orders", String(totals.orders), W));
  kv("Sales", totals.salesPaise);
  kv("  Cash", totals.cashSalesPaise);
  kv("  UPI", totals.upiSalesPaise);
  kv("Discounts", totals.discountsPaise);
  t(twoCol(`Voids (${totals.voids})`, formatAmount(totals.voidedPaise), W));
  lines.push({ kind: "rule" });
  kv("Expenses cash", totals.expenseCashPaise);
  kv("Expenses UPI", totals.expenseUpiPaise);
  kv("Cash put in", totals.cashInPaise);
  kv("Cash taken out", totals.cashOutPaise);
  lines.push({ kind: "rule" });
  kv("Opening float", day.openingFloatPaise);
  kv("Expected cash", totals.expectedCashPaise);
  if (day.countedCashPaise != null) kv("Counted cash", day.countedCashPaise);
  if (day.variancePaise != null) kv("Difference", day.variancePaise);
  lines.push({ kind: "rule" });
  t(`Opened ${formatDateTime(day.openedAt)} ${day.openedBy}`);
  if (day.closedAt) t(`Closed ${formatDateTime(day.closedAt)} ${day.closedBy ?? ""}`);
  lines.push({ kind: "feed", lines: 3 });
  return lines;
}

export function layoutTestPage(outlet: Outlet, opts: Pick<ReceiptOptions, "width">): ReceiptLine[] {
  const W = opts.width;
  return [
    { kind: "text", text: "PRINTER TEST", align: "center", bold: true, big: true },
    { kind: "text", text: toPrintable(outlet.name), align: "center" },
    { kind: "rule" },
    { kind: "text", text: "1234567890".repeat(5).slice(0, W) },
    { kind: "text", text: twoCol("Left", "Right", W) },
    { kind: "text", text: "Centre", align: "center" },
    { kind: "text", text: "Bold text", bold: true },
    { kind: "text", text: "BIG", big: true },
    { kind: "rule" },
    { kind: "text", text: "Item name sizes:" },
    { kind: "text", text: "Half Veg Steam Momo (normal)", bold: true },
    { kind: "text", text: "Half Veg Steam Momo", bold: true, medium: true },
    { kind: "text", text: "  (medium)" },
    { kind: "text", text: "Half Veg Steam Momo (large)", bold: true, tall: true },
    ...wrap("If 'medium' prints as garbage, pick Normal or Large under Item name size.", W).map(
      (text): ReceiptLine => ({ kind: "text", text }),
    ),
    { kind: "rule" },
    { kind: "text", text: `If every line fits, ${W} chars is right.` },
    { kind: "feed", lines: 3 },
  ];
}

/**
 * Plain-text rendering, one string per receipt line, for the on-screen preview and
 * browser printing. Big lines keep their half-width layout; the preview draws them large.
 */
export function renderText(lines: ReceiptLine[], width: number): string {
  return lines
    .map((l) => {
      if (l.kind === "rule") return "-".repeat(width);
      if (l.kind === "feed") return "";
      const w = l.big ? Math.floor(width / 2) : l.medium ? mediumWidth(width) : width;
      const text = l.text.slice(0, w);
      const padded =
        l.align === "center"
          ? " ".repeat(Math.floor((w - text.length) / 2)) + text
          : l.align === "right"
            ? " ".repeat(w - text.length) + text
            : text;
      return padded;
    })
    .join("\n")
    .trimEnd();
}

function row(name: string, qty: string, amt: string, nameW: number, qtyW: number, amtW: number): string {
  const n = toPrintable(name).slice(0, nameW).padEnd(nameW);
  return `${n} ${qty.padStart(qtyW)} ${amt.padStart(amtW)}`;
}

