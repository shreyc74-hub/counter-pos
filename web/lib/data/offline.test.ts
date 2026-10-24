import { describe, expect, it } from "vitest";
import type { Order } from "@/lib/domain/types";
import { UnsavedBills, mergeUnsaved } from "./offline";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const o = (id: string, at: string, day = "d1") => ({ id, createdAt: at, daySessionId: day }) as Order;

describe("UnsavedBills", () => {
  it("adds once, marks refused, removes", () => {
    const u = new UnsavedBills(mem());
    u.add(o("a", "1"));
    u.add(o("a", "1"));
    expect(u.list()).toHaveLength(1);
    expect(u.markRefused("a", "price changed")[0].refused).toBe("price changed");
    expect(u.remove("a")).toEqual([]);
  });

  it("merges kept bills of the same day into the list without duplicates", () => {
    const merged = mergeUnsaved([o("s1", "2026-10-24T08:00"), o("k1", "2026-10-24T07:00")], [
      { order: o("k1", "2026-10-24T07:00"), refused: null },
      { order: o("k2", "2026-10-24T09:00"), refused: null },
      { order: o("old", "2026-10-23T09:00", "d0"), refused: null },
    ], "d1");
    expect(merged.map((x) => x.id)).toEqual(["k2", "s1", "k1"]);
  });
});
