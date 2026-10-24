import { describe, expect, it, vi } from "vitest";
import type { Order } from "@/lib/domain/types";
import { SheetsBackup, billRows } from "./sheets";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

const order: Order = {
  id: "o1", billNo: "T1-000007", token: 3, deviceCode: "T1", staffId: "s", staffName: "Manek", daySessionId: "d1",
  channel: "counter", externalOrderId: null, note: null, subtotalPaise: 22000, totalPaise: 20000,
  discount: { amountPaise: 2000, reason: "Regular", approvedBy: null },
  lines: [
    { key: "a", kind: "variant", refId: "v1", name: "Veg Momos Steam Full", qty: 2, unitPricePaise: 10000, unitCostPaise: null,
      modifiers: [{ modifierId: "m", name: "Extra chutney", pricePaise: 1000, costPaise: null }] },
  ],
  payments: [{ method: "cash", amountPaise: 15000, cashReceivedPaise: 20000 }, { method: "upi", amountPaise: 5000, cashReceivedPaise: null }],
  createdAt: "2026-10-24T08:00:00.000Z", menuVersion: 1, voided: null,
};

describe("billRows", () => {
  it("makes one bill row and one row per item, in rupees", () => {
    const [bill, item] = billRows(order, "2026-10-24", false);
    expect(bill.values.length).toBe(bill.headers.length);
    expect(bill.values).toContain("T1-000007");
    expect(bill.values.slice(8, 14)).toEqual([220, 20, "Regular", 200, 150, 50]);
    expect(bill.values.at(-1)).toMatch(/^NO/);
    expect(item.id).toBe("o1:1");
    expect(item.values.slice(3)).toEqual(["Veg Momos Steam Full (Extra chutney)", 2, 110, 220]);
  });
});

describe("SheetsBackup", () => {
  it("keeps rows until the sheet confirms them, and reports failures", async () => {
    const storage = mem();
    let up = false;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify({ configured: true }));
      if (!up) return new Response(JSON.stringify({ ok: false, error: "Google down" }), { status: 502 });
      return new Response(JSON.stringify({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const b = new SheetsBackup("/api/backup", storage);
    b.add(billRows(order, "2026-10-24", true));
    await vi.waitFor(() => expect(b.getStatus().state).toBe("failing"));
    expect(b.getStatus()).toMatchObject({ pending: 2, error: "Google down" });
    up = true;
    await b.flush();
    expect(b.getStatus()).toEqual({ state: "ok", pending: 0 });
    // Adding the same bill again is a no-op once it's queued; re-sends are de-duplicated by the sheet.
    vi.unstubAllGlobals();
  });

  it("says when no sheet is set up", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ configured: false }))));
    const b = new SheetsBackup("/api/backup", mem());
    await b.flush();
    expect(b.getStatus().state).toBe("off");
    vi.unstubAllGlobals();
  });
});
