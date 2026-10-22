# Product vision

**One line:** A fast native POS for my counter that **helps me make more profit** by turning every order, payment and expense into decisions I can act on.

Money-out tracking is one of several things it does. It isn't the whole product.

## The three jobs (in priority order)

1. **Never slow down the counter.** Take an order in under 5 taps, mark it Cash or UPI, and move on. Billing never stops (offline in the Android app).
2. **One trustworthy record of the business.** Every sale, void, discount, expense and cash movement is recorded once, can't be quietly edited, and belongs to a staff member. This fixes "inconsistent data".
3. **Tell me how to make more money.** Show, in plain language, what's working, what's leaking, and what to change tomorrow.

## Profit levers → the insight → the data V1 must capture

Insights are only as good as the data captured from day one. This table makes sure V1 records what later insights need, even when the insight itself ships in V2.

| Profit lever | Example insight | Data V1 must capture | Insight ships in |
|---|---|---|---|
| **Sell more per order** (AOV) | "Only 12% of momo orders add a drink. A ₹20 drink combo could add ~₹X/day" | Line items with variants, add-ons, combos; timestamps | V1 basic (AOV, top items) · V2 (item pairs, combo suggestions) |
| **Better margin per item** | "Chicken Fried Full sells most but earns ₹18 less than Paneer Steamed Full" | **Cost per item/variant** (manual entry), price at time of sale | V1 (if cost entered) |
| **Less wastage** | "Prepare 35 veg steamed between 6–8pm on Fridays, not 50" | Order time to the minute, items per slot, **plates wasted at close** (optional entry) | V2 (needs 4–8 weeks of data) |
| **Stop leakage** | "Cash was ₹340 short on Tuesday. 6 voids by one staff member this week" | Staff on every action, void/discount reasons, day open/close cash count | V1 |
| **Control money out** | "Packaging spend is up 30% this month" | Expenses with category, amount, cash/UPI, who | V1 |
| **Right hours and staffing** | "Sales before noon don't cover the cost of opening; peak is 7–9pm" | Hourly sales; optionally staff shifts | V1 (hourly) · V2 (staffing) |
| **Keep customers coming back** | "40 regulars ordered 3+ times this month" | Optional customer phone with consent | V2 |
| **Channel profit** (Swiggy/Zomato vs counter) | "After commission, Zomato orders earn 22% less per plate" | Order channel; aggregator commission % | V1 (channel split) · V2 (net margin) |
| **Pricing** | "Price change on Veg Fried didn't reduce volume" | Price history per item | V2 |

## How insights are delivered

- **Live dashboard** (admin panel): today's sales, money in vs out, cash expected in the drawer, top items.
- **Daily summary** to your phone at close: numbers + 2–3 plain-language actions for tomorrow.
- **Weekly review**: trends, margin, wastage, leakage.
- AI turns computed numbers into sentences. It **never invents numbers** (designed in Phase 2).

## What this means for the plan

- The final product is a **native Android POS** (D-202). The website (D-207) is a testing step, and the admin panel stays on the web.
- V1 has to capture **cost per item**, **staff on every action**, and **exact timestamps** from the start, or the profit insights have nothing to work with.
