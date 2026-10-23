# Counter POS

Fast counter billing for a momo / Chinese food outlet: orders in ≤5 taps, cash or UPI,
Bluetooth receipt printing, day open/close with a cash check, expenses, and (next) an
admin panel with insights. Planning docs are in [`docs/`](docs/); every decision is in
[`docs/decisions.md`](docs/decisions.md).

| Folder | What it is |
|---|---|
| `web/` | Next.js app. `/counter` is the counter screen (the admin panel comes next) |
| `supabase/` | Database: tables, business rules (`pos_*` functions), demo data, tests |
| `docs/` | Research, architecture, V1 plan, decisions |

## Try it in 1 minute (no backend)

```bash
cd web
npm install
npm run dev        # open http://localhost:3000
```

With no Supabase settings the app runs on **demo data stored in your browser**.
Demo PINs: **Shrey 1234** (owner), **Ramesh 1111**, **Sita 2222**.

## Printing to the thermal printer

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
2. In the project's **SQL editor**, run the files in order:
   `supabase/migrations/20261023000001_core_schema.sql`, then `…02_pos_api.sql`.
   For the demo outlet, also run `supabase/seed.sql` (about 90 days of fake sales; takes a few seconds).
   (If you use the Supabase CLI: run `supabase init` once, then `supabase link` and `supabase db push`.)
3. Copy `web/.env.example` to `web/.env.local` and fill in the project URL and **anon** key
   (Project settings → API).
4. `npm run dev` again. The counter asks for a **device key** once per tablet.
   Demo outlet key: `demo-t1-key`.

Registering the real outlet and tablet (until the admin panel exists), in the SQL editor:

```sql
insert into outlets (name, address_line, phone, fssai_no) values ('…', '…', '…', '…') returning id;
insert into devices (outlet_id, code, name, token_hash)
  values ('<outlet id>', 'T1', 'Counter tablet', _hash_key('<choose a long random key>'));
insert into staff (outlet_id, name, role, pin_hash)
  values ('<outlet id>', 'Shrey', 'owner', extensions.crypt('<4-digit PIN>', extensions.gen_salt('bf')));
```

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
cd web && npm test            # money, cart, bill numbers, receipt layout, printer bytes, demo store
cd web && npm run typecheck
supabase/tests/run-local.sh   # database: runs migrations + seed + 42 API checks on a throwaway Postgres 16
```

## Deploying

The web app deploys to Vercel (or any Next.js host) from the `web/` folder; set the two
`NEXT_PUBLIC_SUPABASE_*` variables there. Direct Bluetooth printing needs the https address
the host provides.
