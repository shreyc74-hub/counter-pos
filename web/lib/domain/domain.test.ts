import { describe, expect, it } from "vitest";
import { demoMenu } from "@/lib/data/demoMenu";
import { businessDate, computeDayTotals, formatBillNo } from "./billing";
import {
  addToCart,
  buildPayments,
  changeDuePaise,
  changeQty,
  findSellable,
  subtotalPaise,
  totalPaise,
} from "./cart";
import { formatAmount, formatRupees, rupeesToPaise } from "./money";
import type { DaySession, Order } from "./types";

const sell = (id: string) => {
  const s = findSellable(demoMenu, id);
  if (!s) throw new Error(`missing ${id}`);
  return s;
};
const mayo = demoMenu.modifiers.find((m) => m.id === "mod-mayo")!;

describe("money", () => {
  it("formats rupees with Indian grouping", () => {
    expect(formatRupees(13500)).toBe("₹135");
    expect(formatRupees(2786000)).toBe("₹27,860");
    expect(formatRupees(123456789)).toBe("₹12,34,567.89");
    expect(formatRupees(-14000)).toBe("−₹140");
  });
  it("formats receipt amounts", () => {
    expect(formatAmount(12500)).toBe("125.00");
    expect(formatAmount(-1000)).toBe("-10.00");
  });
  it("parses rupee input", () => {
    expect(rupeesToPaise("125")).toBe(12500);
    expect(rupeesToPaise("₹1,250.5")).toBe(125050);
    expect(rupeesToPaise("")).toBeNull();
    expect(rupeesToPaise("12.345")).toBeNull();
    expect(rupeesToPaise("abc")).toBeNull();
  });
});

describe("cart", () => {
  it("adds, merges identical lines and totals with add-ons", () => {
    let lines = addToCart([], sell("v-veg-stm-full"), "a", [mayo]);
    lines = addToCart(lines, sell("v-drink-250"), "b");
    lines = addToCart(lines, sell("v-veg-stm-full"), "c", [mayo]);
    expect(lines).toHaveLength(2);
    expect(lines[0].qty).toBe(2);
    expect(lines[0].name).toBe("Veg Momos Steamed Full");
    expect(subtotalPaise(lines)).toBe(2 * (10000 + 1000) + 2500);
  });
  it("keeps the same item with different add-ons on separate lines", () => {
    let lines = addToCart([], sell("v-veg-stm-full"), "a", [mayo]);
    lines = addToCart(lines, sell("v-veg-stm-full"), "b");
    expect(lines).toHaveLength(2);
  });
  it("removes a line when qty reaches zero", () => {
    const lines = addToCart([], sell("v-drink-250"), "a");
    expect(changeQty(lines, "a", -1)).toEqual([]);
  });
  it("snapshots cost for margin insights", () => {
    const [line] = addToCart([], sell("combo-1"), "a");
    expect(line.kind).toBe("combo");
    expect(line.unitCostPaise).toBe(6000);
  });
  it("never lets a discount push the total below zero", () => {
    const lines = addToCart([], sell("v-drink-250"), "a");
    expect(totalPaise(lines, 1000)).toBe(1500);
    expect(totalPaise(lines, 99999)).toBe(0);
  });
  it("builds cash, UPI and split payments with change", () => {
    expect(buildPayments(12500, "upi")).toEqual([{ method: "upi", amountPaise: 12500, cashReceivedPaise: null }]);
    const cash = buildPayments(12500, "cash", { cashReceivedPaise: 20000 });
    expect(changeDuePaise(cash)).toBe(7500);
    const split = buildPayments(12500, "split", { cashPartPaise: 5000 });
    expect(split.map((p) => [p.method, p.amountPaise])).toEqual([
      ["cash", 5000],
      ["upi", 7500],
    ]);
  });
});

describe("billing", () => {
  it("formats bill numbers per device", () => {
    expect(formatBillNo("T1", 124)).toBe("T1-000124");
    expect(formatBillNo("T2", 1000000)).toBe("T2-1000000");
  });
  it("uses the India business date", () => {
    // 20:00 UTC is 01:30 next day in India
    expect(businessDate(new Date("2026-10-22T20:00:00Z"))).toBe("2026-10-23");
  });
  it("computes expected drawer cash, ignoring voided bills", () => {
    const day: DaySession = {
      id: "d",
      businessDate: "2026-10-22",
      openedAt: "",
      openedBy: "Shrey",
      openingFloatPaise: 100000,
      closedAt: null,
      closedBy: null,
      expectedCashPaise: null,
      countedCashPaise: null,
      variancePaise: null,
      leftovers: [],
    };
    const order = (id: string, payments: Order["payments"], voided = false): Order => ({
      id,
      billNo: id,
      token: 1,
      deviceCode: "T1",
      staffId: "s",
      staffName: "S",
      daySessionId: "d",
      channel: "counter",
      externalOrderId: null,
      note: null,
      lines: [],
      subtotalPaise: payments.reduce((a, p) => a + p.amountPaise, 0),
      discount: null,
      totalPaise: payments.reduce((a, p) => a + p.amountPaise, 0),
      payments,
      createdAt: "",
      menuVersion: 1,
      voided: voided ? { reason: "x", by: "S", approvedBy: null, at: "" } : null,
    });
    const t = computeDayTotals(
      day,
      [
        order("a", [{ method: "cash", amountPaise: 12500, cashReceivedPaise: null }]),
        order("b", [
          { method: "cash", amountPaise: 5000, cashReceivedPaise: null },
          { method: "upi", amountPaise: 7500, cashReceivedPaise: null },
        ]),
        order("c", [{ method: "cash", amountPaise: 99900, cashReceivedPaise: null }], true),
      ],
      [{ id: "e", category: "gas", amountPaise: 2000, method: "cash", note: null, staffId: "s", staffName: "S", daySessionId: "d", createdAt: "" }],
      [{ id: "m", direction: "out", amountPaise: 1000, reason: "x", staffId: "s", staffName: "S", daySessionId: "d", createdAt: "" }],
    );
    expect(t.orders).toBe(2);
    expect(t.salesPaise).toBe(25000);
    expect(t.cashSalesPaise).toBe(17500);
    expect(t.upiSalesPaise).toBe(7500);
    expect(t.voids).toBe(1);
    expect(t.expectedCashPaise).toBe(100000 + 17500 - 2000 - 1000);
  });
});
