# Menu: Street Heaven

> **30 Oct 2026: menu v2 (D-242).** The live menu now copies the old POS: 9 sections, 33 dishes × Half/Full,
> old POS prices (₹60/₹80…). The source is `web/lib/data/menus/street-heaven.json`; this page describes the first version.

Source: the printed menu Shrey shared on 23 Oct 2026. The single source of truth in code is
[`web/lib/data/menus/street-heaven.json`](../web/lib/data/menus/street-heaven.json).
From it, `node supabase/menus/generate.mjs` writes the real-outlet setup script
(`supabase/setup/street-heaven.sql`) and the demo seed's menu. After the outlet is live,
prices and costs are changed in the admin panel, not in these files.

## How it's organised on the counter

- **Momos are grouped by filling** (Paneer, Veg, Soya). Each filling has 8 options:
  Steamed, Fried, Kurkure, Gravy/Schezwan × Half/Full. This keeps prep forecasts per filling
  (how they're made), and the Favourites tab still gives one-tap tiles for the best sellers.
- **Noodles / Rice dishes** each have 4 options: Noodles or Fried Rice × Half/Full (same price).
- **Chinese and Snacks**: Half / Full.
- Free add-ons as quick notes: Less spicy, Extra spicy, Extra chutney (momos), No onion.

16 dishes, 60 priced options.

| Section | Dish | Options and prices (₹) |
|---|---|---|
| Momos | Paneer Momos | Steamed 69 / 99 · Fried 79 / 109 · Kurkure 99 / 149 · Gravy/Schezwan 99 / 159 |
| Momos | Veg Momos | Steamed 59 / 79 · Fried 69 / 89 · Kurkure 89 / 139 · Gravy/Schezwan 99 / 149 |
| Momos | Soya Momos | Steamed 59 / 79 · Fried 69 / 89 · Kurkure 89 / 139 · Gravy/Schezwan 99 / 149 |
| Noodles / Rice | Veg | 79 / 109 |
| Noodles / Rice | Paneer | 89 / 139 |
| Noodles / Rice | Hakka | 89 / 149 |
| Noodles / Rice | Garlic | 89 / 149 |
| Noodles / Rice | Singapuri | 89 / 139 |
| Chinese | Chilli Paneer | 139 / 239 |
| Chinese | Paneer Manchurian | 139 / 239 |
| Chinese | Veg Manchurian | 89 / 159 |
| Chinese | Honey Chilli Potato | 89 / 139 |
| Chinese | Chilli Potato | 79 / 109 |
| Snacks | Spring Roll | 49 / 79 |
| Snacks | Masala French Fries (new) | 69 / 99 |
| Snacks | Kurkure Spring Roll (new) | 89 / 139 |

(Half / Full shown as "half / full".)

Starting Favourites (one-tap tiles, a guess until real sales data replaces it): Veg Steamed Full,
Paneer Steamed Full, Veg Fried Full, Paneer Fried Full, Paneer Kurkure Full, Veg Kurkure Full,
Veg Steamed Half, Paneer Gravy Full, Hakka Noodles Full, Veg Noodles Full, Chilli Paneer Half,
Honey Chilli Potato Half.

## Open questions

1. **Gravy / Schezwan**: one dish where the customer picks gravy *or* schezwan (same price), or two
   different dishes? Today it's one option; a free "Schezwan" add-on can record the choice.
2. **Free soup with every order**: it has a real cost. Should the app count a soup cost on every
   order so margins are true? (Needs the cost of one soup.)
3. **Chinese dishes**: dry or gravy versions, or just Half / Full as printed?
4. **Costs** for every option (rough is fine), entered in Admin → Menu & prices.
5. **Delivery minimum ₹150** for phone orders: should the counter warn below ₹150 for "Phone" orders?
6. **FSSAI number** for the receipt footer.
