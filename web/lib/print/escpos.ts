import type { ReceiptLine } from "./receipt";

// Minimal ESC/POS encoder: just the commands cheap 58/80 mm printers reliably support.
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export interface EncodeOptions {
  /** Partial cut at the end. Most 58 mm portable printers have no cutter. */
  cut?: boolean;
}

export function encodeReceipt(lines: ReceiptLine[], opts: EncodeOptions = {}, width = 32): Uint8Array {
  const out: number[] = [];
  const push = (...b: number[]) => out.push(...b);
  const text = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out.push(c >= 0x20 && c <= 0x7e ? c : 0x3f); // '?' for anything outside ASCII
    }
  };

  push(ESC, 0x40); // initialise
  push(ESC, 0x74, 0x00); // code page 437 (plain ASCII range is identical everywhere)

  for (const l of lines) {
    if (l.kind === "rule") {
      push(ESC, 0x61, 0x00);
      text("-".repeat(width));
      push(LF);
      continue;
    }
    if (l.kind === "feed") {
      push(ESC, 0x64, Math.max(0, Math.min(255, l.lines))); // print and feed n lines
      continue;
    }
    push(ESC, 0x61, l.align === "center" ? 0x01 : l.align === "right" ? 0x02 : 0x00);
    push(ESC, 0x45, l.bold ? 0x01 : 0x00);
    push(GS, 0x21, l.big ? 0x11 : 0x00); // double width + double height
    text(l.text);
    push(LF);
    if (l.big) push(GS, 0x21, 0x00);
    if (l.bold) push(ESC, 0x45, 0x00);
  }
  push(ESC, 0x61, 0x00);
  if (opts.cut) push(GS, 0x56, 0x42, 0x00); // feed and partial cut
  return Uint8Array.from(out);
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return typeof btoa === "function" ? btoa(s) : Buffer.from(bytes).toString("base64");
}
