import type { Paise } from "./types";

/** ₹1,234 or ₹1,234.50 for display (Indian digit grouping). */
export function formatRupees(paise: Paise): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  const grouped = groupIndian(rupees);
  const text = rest === 0 ? grouped : `${grouped}.${String(rest).padStart(2, "0")}`;
  return `${negative ? "−" : ""}₹${text}`;
}

/** 1234.50 for receipts: plain ASCII, always two decimals, no grouping. */
export function formatAmount(paise: Paise): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  return `${negative ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function rupeesToPaise(input: string): Paise | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

function groupIndian(n: number): string {
  const s = String(n);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}
