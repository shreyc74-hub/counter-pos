# Counter POS

Fast counter billing for a momo / Chinese food outlet: orders in ≤5 taps, cash or UPI,
Bluetooth receipt printing, day open/close with a cash check, expenses, and an admin
panel with the menu, prices and costs, and a live dashboard. Planning docs are in [`docs/`](docs/); every decision is in
[`docs/decisions.md`](docs/decisions.md).

| Folder | What it is |
|---|---|
| `web/` | Next.js app. `/counter` is the counter screen, `/admin` is the owner's admin panel |
| `supabase/` | Database: tables, business rules (`pos_*` counter and `admin_*` owner functions), demo data, tests |
| `docs/` | Research, architecture, V1 plan, decisions |

## Try it in 1 minute (no backend)

```bash
cd web
npm install
npm run dev        # open http://localhost:3000
```

With no Supabase settings the app runs on **demo data stored in your browser**.
Demo PINs: **Shrey 1234** (owner), **Ramesh 1111**, **Sita 2222**.
Open `/admin` and enter **1234** to see the dashboard on 90 days of made-up sales, and
edit the menu. Menu changes made there show up on the demo counter in the same browser.

## Admin panel (`/admin`)

- **Dashboard:** today (live, refreshes every 30 s) or the last 7 / 30 / 90 days. Sales, orders,
  average order value, gross margin, cash vs UPI, money out, expected drawer cash;
  orders by hour against a usual day; sales by day; items by sales and margin; money out by
  category; voids, discounts and cash shortfalls by staff; day-by-day list; and a
  "Needs your attention" list (high voids, cash short, drink add-on rate, sell-outs,
  rising costs, items without a cost). Today is compared with the same weekday over the
  last 4 weeks *up to the same time of day*.
- **Menu & prices:** categories, items, sizes, add-ons, combos, and the counter's
  Favourites tiles. Prices and costs show the margin as you type; every change is kept
  in the price history, and old bills keep the price they were sold at.
- **Dish photos:** in Menu & prices, tap **+ Photo** next to a dish and take or pick a
  photo (works from the tablet or a phone). It is shrunk on the device (a camera photo
  becomes ~10–60 KB) and shows on that dish's Half and Full tiles after the counter
  reloads. **Remove** takes it off again.

## Counter screen layout

Built for the realme Pad Mini (RMP2105) held upright (Chrome: 601 × 838), copying the
old POS: sections down the left, Half | Full tiles (one tap adds), and an order bar with
the total, **Dine in / Takeaway** and **Confirm order**, which slides up the cart
(Less spicy / Extra spicy on each item, discount, note, CASH / UPI). The ☰ button holds
Orders today, Expense / cash, Close day, Printer and today's totals. Counter orders need
Dine in or Takeaway before payment; it is printed big on the receipt.

- **Not paid (dine in):** with Dine in chosen, the cart also offers **NOT PAID · pay after
  eating**. The bill is saved and printed with NOT PAID; a "1 not paid" button stays at the
  top until it is paid from Orders today (**Paid CASH / Paid UPI**). The day can't be closed
  while a bill is still not paid (pay it or void it).
- **Refresh-safe cart:** the order being built is kept on the device, so a page refresh
  doesn't lose it (items no longer on the menu are dropped, prices refreshed).

**To change the layout** (sidebar width, tiles per row, tile height, font sizes,
colours), edit the numbers at the top of [`web/app/pos-layout.css`](web/app/pos-layout.css);
the notes there explain each one and how to preview a tablet size on a computer.

## Printing to the thermal printer

**Item name size** (Printer screen): *Medium* (default) prints dish names 1¼× size, between
the normal text and the big shop name, each on its own line with "qty x price / amount"
under it. Printers have no 1¼× font, so medium names print as a small picture of the text
(standard ESC/POS raster); every dish name fits on one line of 58 mm paper. *Normal* and
*Large* (double height, the earlier look) use the printer's own font. The **test page**
prints all three: if medium comes out as garbage on a printer, choose Normal or Large.


Open **Printer** in the bottom bar and pick one:

| Option | Use when | Notes |
|---|---|---|
| **Bluetooth (direct from Chrome)** | The printer supports Bluetooth LE | Needs Chrome on Android/laptop and an **https** address (or `localhost`). Tap *Connect printer*, pick the printer, *Print test page* |
| **RawBT app** | The printer is classic Bluetooth only (most cheap 58 mm printers) | Install *RawBT* from the Play Store, select the printer inside RawBT once. Receipts from the counter are then handed to RawBT |
| **Browser print dialog** | USB printer on a laptop, or checking the layout as PDF | |

Not sure which your printer is? Try Bluetooth first: if the printer doesn't show in the
list, use RawBT. Choose **58 mm** or **80 mm** paper and print the test page: every line
should fit.

A bill is always saved **before** it prints. If printing fails, the bill is safe and the
receipt screen shows **Retry**.

## Connecting the real backend (Supabase)

1. Create a project at [supabase.com](https://supabase.com) (the free tier is fine for testing).
2. In the project's **SQL editor**, paste and run **`supabase/setup/all-in-one.sql`** (everything below in one file), or run the files in order:
   `supabase/migrations/20261023000001_core_schema.sql`, then `…02_pos_api.sql`, then `…03_admin_api.sql`.
   Then **`supabase/setup/street-heaven.sql`**: the real outlet with the full menu and prices (no fake data,
   costs empty). Its last lines show how to add your email, the tablet's device key and staff PINs.
   Optional, for trying things out: `supabase/seed.sql` adds a separate demo outlet with ~90 days of fake sales.
   (If you use the Supabase CLI: run `supabase init` once, then `supabase link` and `supabase db push`.)
   **Already ran an earlier version?** Run only the migration files you haven't run yet (e.g. `…04_device_login.sql`).
   **Live already (Street Heaven, before 30 Oct 2026)?** Run `supabase/migrations/20261030000005_service_and_photos.sql`
   (dine in / takeaway, dish photos), then `supabase/setup/street-heaven-menu-v2.sql` (switches to the old POS's
   sections, names and prices; old bills are untouched, old dishes are switched off, not deleted). Both are safe to run twice.
   Then reload the counter.
3. Add the project URL and the **anon / publishable** key (Supabase → Project settings → API keys)
   as environment variables, in Vercel (Settings → Environment Variables, tick Production, then redeploy)
   or in `web/.env.local` for local runs. Either naming works: `SUPABASE_URL` + `SUPABASE_ANON_KEY`, or
   `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (also `…PUBLISHABLE_KEY`).
   Never use the service-role key here; the app ignores it.
4. `npm run dev` again. The counter asks for a **device key** once per tablet.
   Demo outlet key: `demo-t1-key`.
5. **Admin sign-in.** In Supabase → Authentication → URL Configuration, set the **Site URL**
   to your app's address (e.g. `https://your-app.vercel.app`) and add `https://your-app.vercel.app/admin`
   to **Redirect URLs**. Then link your email to the outlet once, in the SQL editor:
   `update outlets set owner_email = 'you@example.com' where name = 'Street Heaven';`
   Open `/admin`, enter that email and click the link Supabase emails you. (To use the
   6-digit code instead, add `{{ .Token }}` to the *Magic Link* email template.)

The menu's source is `web/lib/data/menus/street-heaven.json` (see [`docs/menu.md`](docs/menu.md)).
If it changes before go-live, edit the JSON and run `node supabase/menus/generate.mjs`.
After go-live, change prices and costs in the admin panel. (For a big restructure, give the JSON a
new `menuName` and run the generator: it writes `supabase/setup/street-heaven-<menuName>.sql`, which
switches a live outlet over without touching saved bills.)

### Devices and sign-in

- Each phone/tablet is a **device** with a name and a key. The first screen lists the
  outlet's devices by name; pick yours and type its key once (the phone remembers it).
- A device can be **linked to a person** (`devices.auto_staff_id`): its key signs straight
  in as them, with no PIN screen and no auto-lock. This is the setup for a one-person
  outlet. Devices not linked to a person use staff PINs as before.
- The **admin panel** accepts the same owner-linked devices: on a phone already set up as a
  counter it opens directly; elsewhere pick the device and type its key. Email sign-in
  still works too.
- Wrong device keys are throttled: after 10 wrong keys in an hour, key entry pauses until
  the hour has passed.

### What the backend guarantees

- The counter can only call the `pos_*` functions; tables are not reachable from the app.
- Prices, totals, discounts and payments are re-checked on the server. Costs are
  recorded on the server at the moment of sale and never sent to the counter.
- Bills, payments, voids, expenses and closed days **cannot be edited or deleted**, even by
  the database owner (append-only triggers). A void is a separate record with who and why.
- Saving a bill twice (e.g. a retry after a network drop) stores it once.
- Discounts above the cashier limit and cashier voids need the owner's PIN.
  Five wrong PINs lock the tablet for a minute.

## Tests

```bash
cd web && npm test            # money, cart, bill numbers, receipt layout, printer bytes, demo store, dashboard metrics
cd web && npm run typecheck
supabase/tests/run-local.sh   # database: migrations + seed + real-outlet setup + 66 checks on a throwaway Postgres 16
```

## Deploying

The web app deploys to Vercel (or any Next.js host) from the `web/` folder; set the two
`NEXT_PUBLIC_SUPABASE_*` variables there. Direct Bluetooth printing needs the https address
the host provides.
