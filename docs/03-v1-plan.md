# Phase 3: V1 plan

**Status:** Proposal. HYPOTHESIS until Shrey approves (decisions D-4xx).
**Date:** 22 Oct 2026
**Builds on:** `00-vision.md`, `01-research.md`, `02-architecture.md` (approved), `decisions.md`.

V1 ships in two parts, in this order (D-207):
- **V1-Web:** backend + admin panel + counter screen on the website, online-only, no printing, tested on the demo outlet and then used at the counter.
- **V1-Android:** native counter app with offline billing and Posiflow printing, on the same backend.

> Note: the original brief said "the first milestone proves printing". Shrey later chose no printing in the website phase (D-208), so the printing proof is now the **first Android milestone (A1)**. The optional 10-minute RawBT check (R-2) is still recommended before then.

---

## 1. V1 feature list

| Area | Feature | V1-Web | V1-Android |
|---|---|---|---|
| **Counter** | PIN login per staff member, auto-lock after idle | ✅ | ✅ |
| | Item grid by category + **favourite tiles** (top variants one tap away) | ✅ | ✅ |
| | Variants, add-ons, notes, fixed combos | ✅ | ✅ |
| | Order channel: counter / Swiggy / Zomato / phone, with external order ID | ✅ | ✅ |
| | Payment: **Cash or UPI**, split; cash change calculator | ✅ | ✅ |
| | Token number for pickup | ✅ | ✅ |
| | On-screen receipt | ✅ | ✅ |
| | **Printed receipt** (Posiflow), reprint marked DUPLICATE | – | ✅ |
| | Mark item **sold out** / back in | ✅ | ✅ |
| | Void (reason; owner PIN if required), discount (reason, limit) | ✅ | ✅ |
| | Today's orders list, search by bill number/token | ✅ | ✅ |
| | Quick expense / cash-out entry | ✅ | ✅ |
| | Day open (float) / day close (cash count, variance, optional leftovers, Z-report) | ✅ | ✅ |
| | Works offline, syncs later | – (online-only) | ✅ |
| **Admin** | Menu: categories, items, variants, add-ons, combos, on/off | ✅ | (web) |
| | **Prices and costs**, effective-dated, with history | ✅ | (web) |
| | Staff (roles, PINs), devices (register, code T1/T2) | ✅ | (web) |
| | Expenses list + categories | ✅ | (web) |
| | **Live dashboard**: sales today, money in vs out (cash/UPI), expected drawer cash, orders/hour, top items | ✅ | (web) |
| | Reports: sales by hour/day, AOV, item mix, **margin**, payment mix, channel mix, voids/discounts by staff, cash variance by day, expense trend | ✅ | (web) |
| | Day history + Z-reports | ✅ | (web) |
| | Prep forecast (per item × slot), once ≥4 weeks of data | ✅ (on demo data from day one) | (web) |
| | Insights page (template text first, AI narration after M7) | ✅ | (web) |
| | Demo outlet switcher with a clear "DEMO" badge | ✅ | ✅ |
| | Export (CSV) | ✅ | (web) |
| **Summary** | Daily Telegram summary at day close | ✅ | ✅ |
| **Ops** | Error logging (Sentry), print-job log, unsynced-count alert | ✅ (no print) | ✅ |

**Not in V1:** GST invoicing (deferred), payment gateway, KOT, stock/recipe tracking, loyalty, aggregator API integration, WhatsApp, multi-outlet UI (schema-ready only), card payments.

---

## 2. Screens (wireframe descriptions)

### 2.1 Counter (tablet landscape first; works on phone portrait)

**C1. PIN lock**
- Big number pad, staff name appears on a correct PIN. Shows outlet, device code (T1) and online status. DEMO badge if on the demo outlet.

**C2. Order screen (the main screen)**
```
┌────────────────────────────────────────────┬───────────────────────┐
│ [★ Fav] [Momos] [Chinese] [Drinks] [Combos]│ Token 42   Counter ▾  │
├────────────────────────────────────────────┤───────────────────────│
│ ┌──────────┐┌──────────┐┌──────────┐       │ Veg Stm Full   1  100 │
│ │Veg Stm F ││Veg Fry F ││Chk Stm F │       │ Coke 250       1   25 │
│ │  ₹100    ││  ₹120    ││  ₹130    │       │   + extra mayo     10 │
│ └──────────┘└──────────┘└──────────┘       │                       │
│ ┌──────────┐┌──────────┐┌──────────┐       │                       │
│ │Veg Chow H││Coke 250  ││Combo 1   │       │───────────────────────│
│ │  ₹60     ││  ₹25     ││  ₹115    │       │ Total          ₹135   │
│ └──────────┘└──────────┘└──────────┘       │ [Discount] [Note]     │
│  (sold-out tiles greyed, long-press to     │ ┌───────┐ ┌────────┐  │
│   toggle sold out)                         │ │ CASH  │ │  UPI   │  │
│                                            │ └───────┘ └────────┘  │
└────────────────────────────────────────────┴───────────────────────┘
 [Orders] [Expense] [Day]                                   Ramesh ⏻
```
- **Fav tab** = the ~12 most-sold *variants* as direct tiles (auto-ranked from sales, pinnable by the owner).
- Tapping a *base item* (e.g. "Veg Momos") from another tab opens a **variant sheet** (Steamed/Fried × Half/Full) and add-ons, in one sheet.
- Cart: tap a line for +/-, remove, add-on. Channel dropdown (Counter/Swiggy/Zomato/Phone). Swiggy/Zomato asks for the external order ID.
- **Tap count, typical order** "Veg steamed full + Coke, cash": `Veg Stm F` → `Coke 250` → `CASH` → `Done` = **4 taps** ✅. From the category tabs it's 6 (the Fav tab exists to avoid this).

**C3. Payment sheet**
- Cash: optional "received" quick buttons (₹100/200/500/exact), shows change. UPI: one tap "UPI received". "Split" lets you enter a cash part, and the rest is UPI.
- Then **Done** saves the bill, shows the receipt (C4) for 3 seconds or until tapped, and returns to C2 empty.

**C4. Receipt view**
- On-screen version of the receipt (§4). Android: Print / Reprint buttons and print status.

**C5. Orders today**
- List: time, bill number, token, total, method, staff, status. Tap → detail → **Void** (reason list + owner PIN if needed) or **Reprint** (Android).

**C6. Expense / cash movement**
- Amount keypad, category chips, Cash/UPI, note, optional photo. Cash in/out tab for drawer movements.

**C7. Day**
- **Open:** float amount. **Close:** expected cash (shown), counted cash (enter), variance (auto), optional leftovers (+/- per momo item, Skip), confirm. Then the Z-report and Telegram summary.

### 2.2 Admin (desktop/laptop first; works on mobile)

**A1. Live dashboard** (Realtime)
- Tiles: Sales today (vs same weekday avg), Orders, AOV, **Money in** (cash/UPI), **Money out** (cash/UPI), **Net**, **Expected drawer cash**.
- Chart: orders per 30 minutes today vs typical. Lists: top 5 items today, sold-out items, last 10 orders, voids today. Device status: online, unsynced count.

**A2. Reports**
- Date range picker. Tabs: Sales (by hour/day/weekday), Items (qty, revenue, **margin**, rank, pairs), Payments (cash/UPI), Channels, Money out (by category), Leakage (voids, discounts, variance by staff/day).

**A3. Insights**
- Today's/this week's 3–5 bullets with "why" (each opens the numbers behind it). Prep forecast table: item × slot for tomorrow.

**A4. Menu**
- Category list → items → variants (with price and **cost** per variant) → add-on groups → combos. Toggle active. Reorder tiles. Edits show "effective from now" and keep history.

**A5. Costs**
- One grid: every variant with current price, current cost, **margin ₹ and %**, last changed. Bulk edit. Highlights variants with no cost entered.

**A6. Expenses**
- List + filters, categories management, monthly totals.

**A7. Days**
- Calendar of days: sales, variance, voids. Open a day to see the Z-report.

**A8. Staff & devices**
- Staff: name, role, PIN reset, active. Devices: register (shows a one-time code to enter on the device), name, code (T1), last seen.

**A9. Settings**
- Outlet name/address/phone, FSSAI number, receipt footer, Telegram chat link, discount limit, void rules, demo outlet on/off.

---

## 3. Data model (V1)

Conventions: every table has `id uuid pk`, `outlet_id uuid`, `created_at timestamptz`. Money in **paise (integer)** to avoid rounding errors. Financial tables are **insert-only** (enforced by DB rules). `*_by` = staff id.

### Setup
| Table | Key fields |
|---|---|
| `outlets` | name, address, phone, fssai_no, timezone, is_demo |
| `devices` | code (T1), name, kind (web/android), token_hash, last_seen_at, next_bill_seq |
| `staff` | name, role (owner/cashier), pin_hash, active |
| `settings` | key, value (json): receipt footer, discount limit, void rules, telegram chat |

### Menu
| Table | Key fields |
|---|---|
| `categories` | name, sort, active |
| `items` | category_id, name, short_name, is_batch_cooked (for leftovers/forecast), active, sort |
| `variants` | item_id, name (e.g. Steamed Full), short_label (tile text), sort, active |
| `prices` | variant_id, price_paise, effective_from |
| `costs` | variant_id, cost_paise, effective_from, note |
| `modifier_groups` | name, min, max (e.g. "Extras", 0–3) |
| `modifiers` | group_id, name, price_paise, cost_paise, active |
| `item_modifier_groups` | item_id, group_id |
| `combos` | name, price_paise, active |
| `combo_items` | combo_id, variant_id, qty |
| `menu_versions` | version, published_at (devices pull the latest) |

### Sales
| Table | Key fields |
|---|---|
| `orders` | **id (client UUID)**, bill_no (`T1-000124`, unique), device_id, staff_id, day_session_id, token_no, channel (counter/swiggy/zomato/phone), external_order_id, subtotal_paise, discount_paise, total_paise, note, client_created_at, received_at, menu_version |
| `order_lines` | order_id, variant_id **or** combo_id, name_snapshot, qty, unit_price_paise, **unit_cost_paise (snapshot)**, line_total_paise |
| `order_line_modifiers` | line_id, modifier_id, name_snapshot, price_paise, cost_paise |
| `payments` | order_id, method (cash/upi), amount_paise, cash_received_paise |
| `order_adjustments` | order_id, kind (void/discount/refund), amount_paise, reason, by, approved_by |
| `stock_outs` | variant_id, marked_out_at, marked_in_at, by |

### Money and day
| Table | Key fields |
|---|---|
| `expense_categories` | name, active (seed: ingredients, packaging, gas, rent, salary, electricity, maintenance, other) |
| `expenses` | category_id, amount_paise, method (cash/upi), note, photo_url, day_session_id, by |
| `cash_movements` | direction (in/out), amount_paise, reason, day_session_id, by |
| `day_sessions` | business_date, opened_at, opened_by, opening_float_paise, closed_at, closed_by, expected_cash_paise, counted_cash_paise, variance_paise, status |
| `leftovers` | day_session_id, variant_id, plates |

### Ops and insights
| Table | Key fields |
|---|---|
| `events` | type (order_created, order_voided, price_changed, login, …), entity, entity_id, payload json, staff_id, device_id |
| `print_jobs` (Android) | order_id, kind (receipt/duplicate/z), status, attempts, last_error |
| `app_errors` | device_id, where, message, context json |
| `forecasts` | business_date, variant_id, slot_start, predicted_qty, method_version |
| `insight_facts` | period, metric, value, baseline, dims json, fact_code (F12) |
| `insights` | period, text, fact_codes[], source (template/llm), passed_check |

**Key server functions:** `submit_order`, `void_order`, `apply_discount`, `add_expense`, `add_cash_movement`, `open_day`, `close_day`, `set_stock_out`, `register_device`, `publish_menu`.

**Key views:** `v_sales_by_slot`, `v_item_performance` (qty, revenue, cost, margin), `v_payment_mix`, `v_channel_mix`, `v_money_in_out_daily`, `v_leakage_by_staff`, `v_cash_variance`, `v_item_pairs`.

---

## 4. Receipt layout

**58mm (32 characters per line).** Same text is used for the on-screen receipt. No GST lines (D-201).

```
        MOMO CORNER              <- outlet name (double height)
   Shop 4, Main Road, City
      Ph: 98xxxxxx01
--------------------------------
Bill: T1-000124      Token: 42
22-10-2026 19:42     Counter
Staff: Ramesh
--------------------------------
Item               Qty    Amt
Veg Momos Stm Full   1  100.00
  + Extra mayo           10.00
Coke 250ml           1   25.00
--------------------------------
Subtotal                135.00
Discount (Staff meal)   -10.00
TOTAL               Rs 125.00   <- bold, double width
--------------------------------
Paid: Cash 200.00  Change 75.00
--------------------------------
FSSAI: 1xxxxxxxxxxxxx
   Thank you! Visit again
--------------------------------
```

- **80mm:** same layout at 48 characters, longer item names.
- "Rs" instead of "₹" in printed text (most printers can't print ₹ in text mode; the logo/₹ would need raster).
- Optional later: logo (raster), UPI QR, Hindi item names (raster) — measured for speed in A1.
- Duplicate copies print **"DUPLICATE"** under the header. Voided bills print **"VOID"** if reprinted.

---

## 5. Dummy data (demo outlet)

Seed script, deterministic (same random seed, so tests get the same data every time):
- Menu from `menu.md` (6 items, ~16 variants, add-ons, 1 combo), with costs at about 35–55% of price.
- 2 staff (Ramesh, Sita) + owner; devices T1 (web).
- **90 days** of orders, ~100–300/day: evening peak 7–9pm, lunch bump 12–2pm, weekends +30%, a few "rain days" +20%, festival spike day, **drink attach ~12%**, combos ~8% of orders.
- Sold-outs on busy Fridays (e.g. Paneer Fried Full after 8:30pm).
- Voids ~2% overall; **one staff member at ~6% voids** (planted leakage).
- Discounts on ~5% of orders; a few cash variances (one big ₹500 gap).
- Expenses ~₹2,500–4,000/day across categories; packaging creeping up over the last month (planted trend).
- 15% of orders from Swiggy/Zomato with fake external IDs.

**The planted patterns double as tests:** the insights must find the leaking staff member, the packaging trend, the low drink attach rate and the Friday sell-out.

---

## 6. Milestones

Each milestone ends with something Shrey can try. Acceptance criteria in brackets.

### V1-Web
| # | Milestone | Done when |
|---|---|---|
| **W0** | Project setup: repo structure (web + shared + supabase), CI (lint, type-check, tests), Supabase project (free), hosting preview | [A preview URL loads; CI green] |
| **W1** | Database + server functions + **demo seed** | [Demo outlet has 90 days of data; `submit_order` is idempotent; financial tables reject UPDATE/DELETE] |
| **W2** | Admin: menu, variants, add-ons, combos, **prices & costs**, staff, devices | [Shrey can build the real menu in the admin panel; price history kept] |
| **W3** | Counter screen: PIN, order, Cash/UPI, split, receipt on screen, orders list, void/discount, sold out | [Typical order in ≤5 taps; 50 test orders without errors] |
| **W4** | Money: expenses, cash in/out, day open/close, Z-report | [Day close variance correct on demo and test days] |
| **W5** | Live dashboard + reports (incl. margin and leakage) | [Numbers match hand-checked SQL on the demo outlet; dashboard updates within ~2s] |
| **W6** | Daily Telegram summary (templates) + prep forecast | [Summary arrives at close; forecast shown for tomorrow] |
| **W7** | AI insight narration + number checker | [Planted demo patterns are found; checker blocks a deliberately wrong number] |
| **W8** | **Pilot:** Shrey uses the website at the counter for 1 week, alongside the current POS | [Daily totals match the old POS (or differences are explained)] |

### V1-Android
| # | Milestone | Done when |
|---|---|---|
| **A1** | **Printing proof on the Posiflow:** bare app pairs, prints the §4 receipt, reconnects after app restart, handles printer off/out of range/no paper; measure Save→paper time | [10 prints in a row succeed; failures show Retry and never block; time < 3s] |
| **A2** | Counter screen in React Native using the shared package; local SQLite; menu pulled from the backend | [Same ≤5-tap flow; works in airplane mode] |
| **A3** | Outbox sync + device bill numbers + unsynced indicator | [100 offline orders sync with no duplicates or gaps; admin shows them] |
| **A4** | Day open/close, expenses, Z-report print on Android | [Full day runnable on Android alone] |
| **A5** | Pilot on Android (1–2 weeks), then the website counter screen retires | [No lost bills; print success rate logged] |

**Rough effort:** W0–W5 is the bulk (a few weeks of focused building); W6–W8 and A1–A5 follow. ⚠️ Estimates firm up after W1.

---

## 7. Test plan

| Level | What | Examples |
|---|---|---|
| **Unit** (shared TS) | Pricing, totals, discounts, splits, change, bill-number generation, tap-count paths, number checker | Total of lines + add-ons − discount; `T1-000999 → T1-001000`; checker rejects "₹540" if facts say 450 |
| **Database** | Server functions and rules | Same order UUID twice → one order; UPDATE on `orders` fails; void needs a reason; cashier can't void above the rule |
| **Insights** | Against the seeded demo | Leaky staff member flagged; packaging trend flagged; drink attach 12% reported; margin per variant equals hand calc |
| **End-to-end** (web, Playwright) | Real browser flows | PIN → order → Cash → receipt → appears on dashboard; day close variance; menu price change applies to new orders only |
| **Printer** (A1, real Posiflow) | The test matrix below | |
| **Sync** (A3) | Airplane-mode chaos | 100 orders offline, kill app mid-sync, reconnect, verify count and totals |
| **Pilot** (W8, A5) | Real use | Compare daily totals with the old POS; collect staff feedback on speed |

**Printer test matrix (A1, on the real Posiflow):**
1. Pair from the app; device remembered by its address.
2. Print the §4 receipt; check alignment at 32 (or 48) characters.
3. Print 10 receipts back to back.
4. Close and reopen the app, then print (reconnect).
5. Turn the printer off, try to print: error with Retry, and you can take the next order.
6. Walk out of range, then come back: queued job prints on Retry.
7. Paper runs out mid-print: job marked failed, reprint works.
8. Bold, double size, alignment, `Rs` amounts.
9. Optional: logo bitmap, UPI QR, a Hindi line, each timed.
10. Record the printer's real model, width and Bluetooth mode into `docs/`.

---

## 8. Success measures for V1

- Typical order **≤5 taps**, and under ~10 seconds from first tap to Done.
- **Zero lost bills**; daily totals reconcile with cash count + UPI.
- Shrey checks the live dashboard / daily summary and can name **one change per week** made because of an insight.
- After 6–8 weeks: measurable change in at least one lever (e.g. drink attach rate, wastage, voids).

---

## Open questions for Shrey

1. **Outlet details for the receipt:** name, address, phone, FSSAI number (placeholders until then).
2. **Void and discount rules:** owner only, or cashier up to a limit (e.g. ₹50)?
3. **Fav tiles:** happy for the app to auto-pick the top 12 variants, with you able to pin your own?
4. **Token numbers:** do you call out tokens today? Reset daily from 1?
5. **Domain:** free hosting URL for testing, or a subdomain you own?
6. **Pilot:** OK to run the website alongside your current POS for a week (W8) to compare totals?
7. **Approval:** say **"Phase 3 approved"** and I'll start building from **W0**.
