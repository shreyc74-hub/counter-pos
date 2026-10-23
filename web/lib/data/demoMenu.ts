import type { Menu, Outlet, Staff } from "@/lib/domain/types";

// Placeholder menu from docs/menu.md. Prices and costs are made up (D-214).
// The real menu will be entered by Shrey in the admin panel.

const r = (rupees: number) => Math.round(rupees * 100);

export const demoOutlet: Outlet = {
  id: "demo-outlet",
  name: "[OUTLET NAME]",
  addressLine: "[Address line, City]",
  phone: "[PHONE]",
  fssaiNo: "[14-DIGIT FSSAI]",
  receiptFooter: "Thank you! Visit again",
  isDemo: true,
  cashierDiscountLimitPaise: r(50),
};

export const demoStaff: (Staff & { pin: string })[] = [
  { id: "staff-shrey", name: "Shrey", role: "owner", pin: "1234" },
  { id: "staff-ramesh", name: "Ramesh", role: "cashier", pin: "1111" },
  { id: "staff-sita", name: "Sita", role: "cashier", pin: "2222" },
];

export const demoMenu: Menu = {
  version: 1,
  categories: [
    { id: "cat-momos", name: "Momos", sort: 1 },
    { id: "cat-chinese", name: "Chinese", sort: 2 },
    { id: "cat-drinks", name: "Drinks", sort: 3 },
  ],
  items: [
    { id: "it-veg-momos", categoryId: "cat-momos", name: "Veg Momos", batchCooked: true, modifierIds: ["mod-mayo", "mod-chutney", "mod-less-spicy"], sort: 1 },
    { id: "it-chk-momos", categoryId: "cat-momos", name: "Chicken Momos", batchCooked: true, modifierIds: ["mod-mayo", "mod-chutney", "mod-less-spicy"], sort: 2 },
    { id: "it-pan-momos", categoryId: "cat-momos", name: "Paneer Momos", batchCooked: true, modifierIds: ["mod-mayo", "mod-chutney", "mod-less-spicy"], sort: 3 },
    { id: "it-veg-chow", categoryId: "cat-chinese", name: "Veg Chowmein", batchCooked: false, modifierIds: ["mod-egg", "mod-less-spicy", "mod-no-onion"], sort: 1 },
    { id: "it-chilli-paneer", categoryId: "cat-chinese", name: "Chilli Paneer", batchCooked: false, modifierIds: ["mod-less-spicy", "mod-no-onion"], sort: 2 },
    { id: "it-cold-drink", categoryId: "cat-drinks", name: "Cold drink", batchCooked: false, modifierIds: [], sort: 1 },
  ],
  variants: [
    { id: "v-veg-stm-half", itemId: "it-veg-momos", name: "Steamed · Half", pricePaise: r(60), costPaise: r(24), active: true, sort: 1 },
    { id: "v-veg-stm-full", itemId: "it-veg-momos", name: "Steamed · Full", pricePaise: r(100), costPaise: r(42), active: true, sort: 2 },
    { id: "v-veg-fry-half", itemId: "it-veg-momos", name: "Fried · Half", pricePaise: r(70), costPaise: r(30), active: true, sort: 3 },
    { id: "v-veg-fry-full", itemId: "it-veg-momos", name: "Fried · Full", pricePaise: r(120), costPaise: r(55), active: true, sort: 4 },
    { id: "v-chk-stm-half", itemId: "it-chk-momos", name: "Steamed · Half", pricePaise: r(80), costPaise: r(40), active: true, sort: 1 },
    { id: "v-chk-stm-full", itemId: "it-chk-momos", name: "Steamed · Full", pricePaise: r(130), costPaise: r(68), active: true, sort: 2 },
    { id: "v-chk-fry-half", itemId: "it-chk-momos", name: "Fried · Half", pricePaise: r(90), costPaise: r(48), active: true, sort: 3 },
    { id: "v-chk-fry-full", itemId: "it-chk-momos", name: "Fried · Full", pricePaise: r(150), costPaise: r(84), active: true, sort: 4 },
    { id: "v-pan-stm-half", itemId: "it-pan-momos", name: "Steamed · Half", pricePaise: r(80), costPaise: r(35), active: true, sort: 1 },
    { id: "v-pan-stm-full", itemId: "it-pan-momos", name: "Steamed · Full", pricePaise: r(130), costPaise: r(58), active: true, sort: 2 },
    { id: "v-pan-fry-half", itemId: "it-pan-momos", name: "Fried · Half", pricePaise: r(90), costPaise: r(42), active: true, sort: 3 },
    { id: "v-pan-fry-full", itemId: "it-pan-momos", name: "Fried · Full", pricePaise: r(150), costPaise: r(71), active: true, sort: 4 },
    { id: "v-veg-chow-half", itemId: "it-veg-chow", name: "Half", pricePaise: r(60), costPaise: r(24), active: true, sort: 1 },
    { id: "v-veg-chow-full", itemId: "it-veg-chow", name: "Full", pricePaise: r(100), costPaise: r(38), active: true, sort: 2 },
    { id: "v-chilli-pan-dry", itemId: "it-chilli-paneer", name: "Dry", pricePaise: r(140), costPaise: null, active: true, sort: 1 },
    { id: "v-chilli-pan-gravy", itemId: "it-chilli-paneer", name: "Gravy", pricePaise: r(150), costPaise: null, active: true, sort: 2 },
    { id: "v-drink-250", itemId: "it-cold-drink", name: "250 ml", pricePaise: r(25), costPaise: r(18), active: true, sort: 1 },
    { id: "v-drink-500", itemId: "it-cold-drink", name: "500 ml", pricePaise: r(40), costPaise: r(30), active: true, sort: 2 },
  ],
  modifiers: [
    { id: "mod-mayo", name: "Extra mayo", pricePaise: r(10), costPaise: r(3) },
    { id: "mod-chutney", name: "Extra chutney", pricePaise: 0, costPaise: r(1) },
    { id: "mod-egg", name: "Extra egg", pricePaise: r(15), costPaise: r(7) },
    { id: "mod-less-spicy", name: "Less spicy", pricePaise: 0, costPaise: 0 },
    { id: "mod-no-onion", name: "No onion", pricePaise: 0, costPaise: 0 },
  ],
  combos: [
    {
      id: "combo-1",
      name: "Combo 1",
      description: "Veg Stm Full + drink 250",
      pricePaise: r(115),
      costPaise: r(60),
      parts: [
        { variantId: "v-veg-stm-full", qty: 1 },
        { variantId: "v-drink-250", qty: 1 },
      ],
      active: true,
    },
  ],
  favourites: [
    "v-veg-stm-full",
    "v-veg-fry-full",
    "v-chk-stm-full",
    "v-chk-fry-full",
    "v-pan-stm-full",
    "v-pan-fry-full",
    "v-veg-stm-half",
    "v-veg-chow-full",
    "v-chilli-pan-dry",
    "v-drink-250",
    "combo-1",
    "v-drink-500",
  ],
};
