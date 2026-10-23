import { describe, expect, it } from "vitest";
import type { Order } from "@/lib/domain/types";
import { DemoStore } from "./demoStore";

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

async function openStore(pin = "1111") {
  const store = new DemoStore(memoryStorage());
  await store.login(pin);
  const day = await store.openDay(100000);
  return { store, day };
}

function order(id: string, dayId: string, billNo: string): Order {
  return {
    id,
    billNo,
    token: 1,
    deviceCode: "T1",
    staffId: "staff-ramesh",
    staffName: "Ramesh",
    daySessionId: dayId,
    channel: "counter",
    externalOrderId: null,
    note: null,
    lines: [],
    subtotalPaise: 10000,
    discount: null,
    totalPaise: 10000,
    payments: [{ method: "cash", amountPaise: 10000, cashReceivedPaise: null }],
    createdAt: new Date().toISOString(),
    menuVersion: 1,
    voided: null,
  };
}

describe("DemoStore", () => {
  it("rejects a wrong PIN", async () => {
    const store = new DemoStore(memoryStorage());
    expect(await store.login("0000")).toBeNull();
    await expect(store.openDay(0)).rejects.toThrow(/PIN/);
  });

  it("numbers bills per device and tokens per day", async () => {
    const { store } = await openStore();
    expect(await store.nextBillNumber()).toEqual({ billNo: "T1-000001", token: 1 });
    expect(await store.nextBillNumber()).toEqual({ billNo: "T1-000002", token: 2 });
  });

  it("treats a resubmitted order as the same order", async () => {
    const { store, day } = await openStore();
    const o = order("o1", day.id, "T1-000001");
    await store.submitOrder(o);
    await store.submitOrder(o);
    expect(await store.listOrders(day.id)).toHaveLength(1);
  });

  it("needs a reason, and an owner PIN for cashier voids", async () => {
    const { store, day } = await openStore("1111");
    await store.submitOrder(order("o1", day.id, "T1-000001"));
    await expect(store.voidOrder("o1", "", null)).rejects.toThrow(/reason/);
    await expect(store.voidOrder("o1", "Wrong item", null)).rejects.toThrow(/Owner PIN/);
    await expect(store.voidOrder("o1", "Wrong item", "2222")).rejects.toThrow(/Owner PIN/);
    await store.voidOrder("o1", "Wrong item", "1234");
    const [o] = await store.listOrders(day.id);
    expect(o.voided).toMatchObject({ reason: "Wrong item", by: "Ramesh", approvedBy: "Shrey" });
  });

  it("closes the day with the cash difference", async () => {
    const { store, day } = await openStore();
    await store.submitOrder(order("o1", day.id, "T1-000001"));
    await store.addExpense({ category: "gas", amountPaise: 2000, method: "cash", note: null });
    const closed = await store.closeDay({ countedCashPaise: 107000, leftovers: [{ variantId: "v", plates: 0 }] });
    expect(closed.expectedCashPaise).toBe(100000 + 10000 - 2000);
    expect(closed.variancePaise).toBe(-1000);
    expect(closed.leftovers).toEqual([]);
    expect(await store.currentDay()).toBeNull();
    await expect(store.submitOrder(order("o2", day.id, "T1-000002"))).rejects.toThrow(/not open/);
  });
});
