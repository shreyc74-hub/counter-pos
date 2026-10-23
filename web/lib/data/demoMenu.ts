import type { Menu, Outlet, Staff } from "@/lib/domain/types";
import source from "./menus/street-heaven.json";

// The demo outlet uses Street Heaven's real menu and prices (menus/street-heaven.json)
// with made-up costs, so the demo looks like the real thing. Real costs are entered
// in the admin panel once the backend is connected.

export interface MenuSource {
  outlet: { name: string; addressLine: string; phone: string; fssaiNo: string; receiptFooter: string };
  categories: { key: string; name: string }[];
  modifiers: { key: string; name: string; price: number }[];
  items: {
    key: string;
    category: string;
    name: string;
    batchCooked: boolean;
    modifiers: string[];
    variants: { key: string; name: string; price: number; demoCost: number | null }[];
  }[];
  favourites: string[];
}

const src = source as MenuSource;
const paise = (rupees: number) => Math.round(rupees * 100);

export const demoOutlet: Outlet = {
  id: "demo-outlet",
  name: src.outlet.name,
  addressLine: src.outlet.addressLine,
  phone: src.outlet.phone,
  fssaiNo: src.outlet.fssaiNo || "[14-DIGIT FSSAI]",
  receiptFooter: src.outlet.receiptFooter,
  isDemo: true,
  cashierDiscountLimitPaise: paise(50),
};

export const demoStaff: (Staff & { pin: string })[] = [
  { id: "staff-shrey", name: "Shrey", role: "owner", pin: "1234" },
  { id: "staff-ramesh", name: "Ramesh", role: "cashier", pin: "1111" },
  { id: "staff-sita", name: "Sita", role: "cashier", pin: "2222" },
];

export const demoMenu: Menu = {
  version: 1,
  categories: src.categories.map((c, i) => ({ id: `cat-${c.key}`, name: c.name, sort: i + 1 })),
  items: src.items.map((it, i) => ({
    id: it.key,
    categoryId: `cat-${it.category}`,
    name: it.name,
    batchCooked: it.batchCooked,
    modifierIds: it.modifiers.map((m) => `mod-${m}`),
    sort: i + 1,
  })),
  variants: src.items.flatMap((it) =>
    it.variants.map((v, i) => ({
      id: v.key,
      itemId: it.key,
      name: v.name,
      pricePaise: paise(v.price),
      costPaise: v.demoCost == null ? null : paise(v.demoCost),
      active: true,
      sort: i + 1,
    })),
  ),
  modifiers: src.modifiers.map((m) => ({ id: `mod-${m.key}`, name: m.name, pricePaise: paise(m.price), costPaise: 0 })),
  combos: [],
  favourites: src.favourites,
};
