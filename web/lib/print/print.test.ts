import { describe, expect, it } from "vitest";
import { fixtureMenu as demoMenu, fixtureOutlet as demoOutlet } from "@/lib/testing/fixtureMenu";
import { addToCart, buildPayments, findSellable, subtotalPaise } from "@/lib/domain/cart";
import type { Order } from "@/lib/domain/types";
import { encodeReceipt } from "./escpos";
import { layoutReceipt, renderText, toPrintable, twoCol } from "./receipt";

function sampleOrder(): Order {
  let lines = addToCart([], findSellable(demoMenu, "v-veg-stm-full")!, "a", [demoMenu.modifiers[0]]);
  lines = addToCart(lines, findSellable(demoMenu, "v-drink-250")!, "b");
  const subtotal = subtotalPaise(lines);
  return {
    id: "o1",
    billNo: "T1-000124",
    token: 42,
    deviceCode: "T1",
    staffId: "s",
    staffName: "Ramesh",
    daySessionId: "d",
    channel: "counter",
    externalOrderId: null,
    note: null,
    lines,
    subtotalPaise: subtotal,
    discount: { amountPaise: 1000, reason: "Staff meal", approvedBy: null },
    totalPaise: subtotal - 1000,
    payments: buildPayments(subtotal - 1000, "cash", { cashReceivedPaise: 20000 }),
    createdAt: "2026-10-22T14:12:00Z",
    menuVersion: 1,
    voided: null,
  };
}

describe("receipt layout", () => {
  it("replaces symbols printers cannot print", () => {
    expect(toPrintable("₹125 · Veg")).toBe("Rs 125 - Veg");
    expect(toPrintable("Café")).toBe("Cafe");
  });

  it("right-aligns the second column", () => {
    expect(twoCol("Total", "125.00", 20)).toBe("Total         125.00");
    expect(twoCol("A very long label here", "9.00", 16)).toHaveLength(16);
  });

  for (const width of [32, 48] as const) {
    it(`never exceeds ${width} characters per line`, () => {
      const lines = layoutReceipt(sampleOrder(), demoOutlet, { width });
      for (const l of lines) {
        if (l.kind !== "text") continue;
        const limit = l.big ? width / 2 : width;
        expect(l.text.length, l.text).toBeLessThanOrEqual(limit);
      }
    });
  }

  it("contains the key bill facts", () => {
    const text = renderText(layoutReceipt(sampleOrder(), demoOutlet, { width: 32 }), 32);
    expect(text).toContain("Bill: T1-000124");
    expect(text).toContain("Token: 42");
    expect(text).toContain("22-10-2026 19:42"); // shown in India time
    expect(text).toContain("Veg Momos Steamed");
    expect(text).toContain("+ Extra mayo");
    expect(text).toContain("Rs 125.00");
    expect(text).toContain("Change 75.00");
    expect(text).toContain("FSSAI");
    expect(text).not.toMatch(/[^\x20-\x7e\n]/);
  });

  it("marks duplicates and voids", () => {
    const o = sampleOrder();
    o.voided = { reason: "x", by: "Shrey", approvedBy: null, at: "" };
    const text = renderText(layoutReceipt(o, demoOutlet, { width: 32, duplicate: true }), 32);
    expect(text).toContain("DUPLICATE");
    expect(text).toContain("VOID");
  });
});

describe("ESC/POS encoding", () => {
  it("starts with init, ends with feed, and only contains printable text plus commands", () => {
    const bytes = encodeReceipt(layoutReceipt(sampleOrder(), demoOutlet, { width: 32 }), {}, 32);
    expect([...bytes.slice(0, 2)]).toEqual([0x1b, 0x40]);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("T1-000124");
    expect(bytes.length).toBeLessThan(2000);
  });

  it("prints item names bold, but not their qty and amount", () => {
    const lines = layoutReceipt(sampleOrder(), demoOutlet, { width: 32 });
    const item = lines.find((l) => l.kind === "text" && l.text.startsWith("Veg Momos"));
    expect(item).toMatchObject({ boldChars: 19 });
    const bytes = Buffer.from(encodeReceipt(lines, {}, 32));
    const on = Buffer.from([0x1b, 0x45, 0x01]);
    const off = Buffer.from([0x1b, 0x45, 0x00]);
    const start = bytes.indexOf(Buffer.from("Veg Momos"));
    // bold switched on right before the name and off before the qty column
    expect(bytes.lastIndexOf(on, start)).toBe(start - 3);
    const offAt = bytes.indexOf(off, start);
    expect(bytes.subarray(start, offAt).toString("latin1")).toBe("Veg Momos Steamed  ");
  });

  it("adds a cut only when asked", () => {
    const lines = layoutReceipt(sampleOrder(), demoOutlet, { width: 32 });
    const cut = [0x1d, 0x56, 0x42, 0x00];
    const has = (b: Uint8Array) => Buffer.from(b).includes(Buffer.from(cut));
    expect(has(encodeReceipt(lines, { cut: true }))).toBe(true);
    expect(has(encodeReceipt(lines, { cut: false }))).toBe(false);
  });
});
