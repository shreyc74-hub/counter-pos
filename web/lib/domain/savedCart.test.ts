import { describe, expect, it } from "vitest";
import { fixtureMenu as menu } from "@/lib/testing/fixtureMenu";
import { addToCart, findSellable } from "./cart";
import { clearSavedCart, loadCart, saveCart } from "./savedCart";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe("cart kept across a refresh", () => {
  const lines = addToCart(addToCart([], findSellable(menu, "v-veg-stm-full")!, "a", [menu.modifiers[0]]), findSellable(menu, "v-drink-250")!, "b");
  const cart = { lines, discount: null, channel: "counter" as const, service: "dine_in" as const, externalId: "", note: "No onion" };

  it("comes back as it was", () => {
    const s = mem();
    saveCart(cart, s);
    expect(loadCart(menu, s)).toEqual(cart);
  });

  it("drops items no longer on the menu and refreshes prices", () => {
    const s = mem();
    saveCart({ ...cart, lines: [{ ...lines[0], unitPricePaise: 1 }, { ...lines[1], refId: "gone" }] }, s);
    const back = loadCart(menu, s)!;
    expect(back.lines).toHaveLength(1);
    expect(back.lines[0].unitPricePaise).toBe(findSellable(menu, "v-veg-stm-full")!.pricePaise);
  });

  it("is forgotten once the bill is saved", () => {
    const s = mem();
    saveCart(cart, s);
    saveCart({ ...cart, lines: [], note: null }, s);
    expect(loadCart(menu, s)).toBeNull();
    saveCart(cart, s);
    clearSavedCart(s);
    expect(loadCart(menu, s)).toBeNull();
  });
});
