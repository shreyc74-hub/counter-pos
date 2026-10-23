import type { Menu } from "@/lib/domain/types";
import type { AdminMenu } from "./types";

/** The counter's view of the menu: active things only, no costs needed. */
export function toCounterMenu(m: AdminMenu): Menu {
  const cats = m.categories.filter((c) => c.active);
  const catIds = new Set(cats.map((c) => c.id));
  const items = m.items.filter((i) => i.active && catIds.has(i.categoryId));
  const itemIds = new Set(items.map((i) => i.id));
  const variants = m.variants.filter((v) => v.active && itemIds.has(v.itemId) && v.pricePaise != null);
  const variantIds = new Set(variants.map((v) => v.id));
  const modifiers = m.modifiers.filter((x) => x.active);
  const modIds = new Set(modifiers.map((x) => x.id));
  const combos = m.combos.filter((c) => c.active && c.pricePaise != null && c.parts.every((p) => variantIds.has(p.variantId)));
  const sellable = new Set([...variantIds, ...combos.map((c) => c.id)]);
  return {
    version: m.version,
    categories: cats.map(({ id, name, sort }) => ({ id, name, sort })),
    items: items.map((i) => ({ ...i, modifierIds: i.modifierIds.filter((x) => modIds.has(x)) })),
    variants: variants.map((v) => ({
      id: v.id,
      itemId: v.itemId,
      name: v.name,
      sort: v.sort,
      active: true,
      pricePaise: v.pricePaise ?? 0,
      costPaise: v.costPaise,
    })),
    modifiers: modifiers.map(({ id, name, pricePaise, costPaise }) => ({ id, name, pricePaise, costPaise })),
    combos: combos.map((c) => ({ ...c, pricePaise: c.pricePaise ?? 0 })),
    favourites: m.favourites.filter((id) => sellable.has(id)),
  };
}

/** The admin view of a counter menu (everything active). */
export function toAdminMenu(m: Menu): AdminMenu {
  return {
    version: m.version,
    categories: m.categories.map((c) => ({ ...c, active: true })),
    items: m.items.map((i) => ({ ...i, active: true })),
    variants: m.variants.map((v) => ({ ...v })),
    modifiers: m.modifiers.map((x) => ({ ...x, active: true })),
    combos: m.combos.map((c) => ({ ...c })),
    favourites: [...m.favourites],
  };
}

export function marginOf(price: number | null, cost: number | null): { amount: number; pct: number } | null {
  if (price == null || cost == null || price <= 0) return null;
  return { amount: price - cost, pct: (price - cost) / price };
}
