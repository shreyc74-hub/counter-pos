# Phase 1: Research (domain + constraints)

**Project:** Custom POS for a single momo / Chinese fast-food counter outlet (India)
**Status:** Draft for Shrey's review (Revision 1 below supersedes parts of the original draft). Nothing here is LOCKED until Shrey approves it in `decisions.md`.
**Date:** 22 Oct 2026

How to read this:
- ✅ **Verified**: backed by a primary or official source that's linked.
- ⚠️ **Unverified**: from a secondary or vendor-biased source, or from my own domain knowledge. Confirm before relying on it.
- 💸 **Expensive to reverse**: getting this wrong later costs real time or money.

---

## Revision 1 (22 Oct 2026): Shrey's feedback

Shrey's decisions after reading the first draft (logged in `decisions.md`):

| Change | Effect on this document |
|---|---|
| **GST / billing compliance parked** (D-201) | §3 stays as reference only. Bills are plain receipts. Rule 46 fields, tax mode and FY invoice numbering are out of V1. FSSAI number on the bill is still recommended (one line, see R-1) |
| **Payments are Cash or UPI, marked manually in the app** (D-203) | §4 gateway, dynamic QR and settlement-reconciliation items drop out. The app just records `payment_method = cash / upi` (plus split, if wanted). Cash-variance at day close still works. UPI "screenshot fraud" is caught by the soundbox, not the app |
| **Android app** (D-202) | §2.2 conclusion confirmed. PWA/Web Bluetooth is off the table. Phase 2 chooses between native Kotlin, Flutter, React Native and Capacitor |
| **First printer: Posiflow, battery-operated** (D-204) | Replaces my "mains-powered" recommendation. See below |

### Posiflow battery printer: what changes

> **Update (D-206):** Shrey asked to assume the printer is always on for now. The sleep and battery items below are **deferred**, not dropped. V1 keeps only the basics: save-before-print, connect retry, print queue, reprint.

- **Model unknown.** Posiflow is an Indian brand with little public documentation. One secondary listing mentions a handheld 58mm Bluetooth "POSIFLOW 58D" ([Accio](https://www.accio.com/business/posiflow)) ⚠️, but I can't confirm your model, its paper width, or whether it does Bluetooth Classic (SPP), BLE or both. Most handheld 58mm units of this type are rebadged Chinese OEM printers with ESC/POS and SPP ⚠️, so the plan in §2 should still apply.
- **Battery means sleep and low-battery are the #1 failure.** Handheld units typically auto-power-off after some idle minutes and run about 1500–2600 mAh ([example spec](https://pdt.static.globalsources.com/IMAGES/PDT/SPEC/480/K1227054480.pdf)) ⚠️. Design for it:
  - **Connect per print job** with 2–3 quick retries, don't hold a socket open.
  - If all retries fail: show "Printer off or asleep: press its power button, then Retry". The bill is **already saved**, so the next order can be taken while that one waits in the print queue.
  - **Find out if auto-off can be disabled or lengthened.** Many OEM printers allow this via a self-test/config menu or vendor app. This is the cheapest fix of all.
  - Keep it **on its charger during service** if the model allows printing while charging.
  - Battery-low behaviour: print gets faint or the printer resets mid-job. The persistent print queue (§2.5) means a failed job is reprinted, not lost.
- **Milestone 1 now tests on this exact printer**: pair, print a sample receipt, leave idle until it sleeps, print again, run the battery low, pull it out of range, run out of paper. Measure time from "Save" to paper.

### What I need about the printer (Q-P1)
A photo of the **label underneath the printer** (model, BT name), the **paper roll width** (58mm or 80mm), and whether it came with a **vendor Android app** (its name). If you can, the pairing name it shows in Android Bluetooth settings.

### Risk R-1: running without GST billing
Fine if you're unregistered and under the threshold. If you are GST-registered, plain receipts are non-compliant, so tell me and we'll bring D-004 back before go-live. Separately, the **FSSAI number on bills applies regardless of GST** (§3.5). I'd keep it on the receipt footer; it's one line of static text.

**Open questions now dropped:** Q1–Q3 (GST status/turnover; except please still give the FSSAI number and state, Q2), Q15–Q16 (UPI provider / gateway). Q12–Q13 are replaced by Q-P1.

---

## TL;DR: the 8 things that matter most

1. **Printing settles the client stack.** Most cheap Indian 58mm Bluetooth printers are Bluetooth Classic (SPP), and some are dual-mode (SPP + BLE). A PWA can only talk BLE through Web Bluetooth, which doesn't exist on iOS at all. So **a native (or natively wrapped) Android app is the safe choice**, and the first milestone must prove printing on *the actual printer you buy*. 💸
2. **Buy a mains-powered counter printer, not a battery "portable" one.** Most "printer went to sleep" failures come from battery printers powering down. A mains-powered 58/80mm desktop printer with Bluetooth (ideally also USB) removes that whole class of bugs.
3. **Your GST registration type changes the bill itself.** Regular scheme: a *tax invoice* with CGST 2.5% + SGST 2.5%. Composition scheme: a *bill of supply*, no tax shown, plus a "composition taxable person" declaration. Below ₹20 lakh turnover and unregistered: no GST at all. The POS has to support whichever applies to you, and I need to know which one that is. 💸
4. **Invoice numbers must be unique and consecutive per financial year, at most 16 characters.** With offline billing this rules out "the server assigns numbers". The device has to assign them locally from a series it owns. 💸
5. **Swiggy/Zomato orders are taxed differently.** The aggregator pays the 5% GST under Section 9(5), not you. These orders have to be tagged separately in the data model from day one, or your GST reports will be wrong. 💸
6. **UPI is effectively free for your ticket size.** From 15 Oct 2026, NPCI's framework puts 0.4% MDR only on P2M payments **above ₹2,000**, and almost no momo bill crosses that. Automatic payment confirmation is possible, but only through a payment gateway's dynamic QR plus webhook, which needs internet.
7. **Direct Swiggy/Zomato POS integration isn't realistic for a self-built POS.** Use manual quick-entry in V1, and import aggregator payout reports later.
8. **The audit trail is a must-have.** There have been press allegations of POS systems being used to delete or under-report bills. Bills in your system should **never be deletable**, only voided, with a reason, a staff ID and a timestamp. That also powers your "leakage by staff" insight.

---

## 1. Competitive teardown

### 1.1 Summary table

| Product | Origin / fit for India | Core features | Pricing (as found) | What small outlets complain about |
|---|---|---|---|---|
| **Petpooja** | India; market leader in restaurant POS | Billing, KOT, 80+ reports, inventory/recipe, CRM, Swiggy/Zomato integration, online ordering, multi-outlet | ⚠️ Not published. Review sites list about $50–$150 per outlet per month across tiers ([FitGap](https://us.fitgap.com/products/petpooja), [GetApp](https://www.getapp.com/all-software/a/petpooja/)). A competitor estimates ₹1,000–₹12,000/month plus GST and add-ons ([DineOpen](https://www.dineopen.com/blog/petpooja-pricing-plans-2026.html), biased source) | ⚠️ Add-on creep (integrations, online ordering, advanced reports sold separately), support slow at peak hours (competitor claim), hardware lock-in. Featureful but heavy for a single counter. |
| **Restroworks (ex-Posist)** | India; aimed at chains and enterprise | Cloud POS, central kitchen, inventory, multi-outlet, analytics | ⚠️ "Contact sales", no public pricing ([Software Advice](https://www.softwareadvice.com/retail/posist-profile/), [G2](https://www.g2.com/compare/par-pos-vs-restroworks-restaurant-pos)) | Overkill and priced for chains. Not designed for a one-counter outlet. |
| **Gofrugal ServeEasy** | India (Chennai); retail and restaurant ERP | POS, KOT, inventory, accounting, Swiggy/Zomato via UrbanPiper | ⚠️ Conflicting figures. Free trial and freemium listed ([TrustRadius](https://trustradius.com/products/gofrugal-serveeasy/reviews), [Capterra IN](https://www.capterra.in/software/71693/gofrugal-pos-software)) | Support rated lower (3.9/5 on Capterra). Reviewers say buying through a partner gets better support than buying direct, and the product is ERP-like and complex. |
| **Loyverse** | Global, free core; used in India | Free POS, KDS, loyalty, basic inventory, multi-store, offline mode | ✅ Core free. Employee management about $5/store/month and advanced inventory $25/store/month ([Loyverse pricing](https://loyverse.com/en-us/pricing)) | Add-ons get pricey outside the US, weak payment options and GST localisation for India ([GetApp](https://www.getapp.com/all-software/a/loyverse-pos/)), limited customisation. **The closest "simple" benchmark for your UX.** |
| **Square for Restaurants** | ❌ Not available in India. Square payments aren't supported there ([Square community](https://community.squareup.com/t5/Using-Square/Getting-started-with-Square/m-p/41995)) | Fast item grid, modifiers, KDS, excellent reporting | n/a in India | Use it as UX inspiration only. |
| **Toast** | ❌ Not in India. US/UK/CA/IE-focused ([Landbase](https://data.landbase.com/technology/toast-pos/)) | Restaurant OS: POS, KDS, payroll, online ordering | n/a in India | Use it as UX and insights inspiration only. |
| **UrbanPiper (Prime/billing)** | India; aggregator middleware with its own billing | Aggregator order hub (Swiggy/Zomato), billing POS | ⚠️ Subscription, quote-based ([UrbanPiper](https://urbanpiper.com/)) | Relevant mainly as **middleware** (see §5). |
| **Vyapar / myBillBook** | India; general GST billing apps for SMBs | GST invoicing, inventory, Bluetooth printing, Android-first | ⚠️ Low-cost annual plans (verify) | Not restaurant-native: no KOT, modifiers or combos, and slow tap-flow at a busy counter. Strong on GST correctness. |
| **DotPe** | India; QR ordering and POS for F&B | QR menu ordering, POS, payments | ⚠️ Not verified | ⚠️ Tied to their payment stack (verify). |

> Caveat: there's very little public, independent review data on Indian POS products. Reddit and forum searches turned up almost nothing first-hand, and most "reviews" are written by competing vendors. **Your own complaints about your current POS are the best data source we have**, so I've asked for them in the open questions.

### 1.2 Gaps a single-outlet owner cares about (and where we can win)

| Gap | Why incumbents miss it | Our angle |
|---|---|---|
| **Speed at the counter** | Built for dine-in restaurants: tables, captains, multi-screen flows | Single-screen grid tuned to *your* top 20 items, with combos one tap away |
| **Insights that tell you what to do** | 80+ reports, no recommendations | Few metrics, plus plain-language "do this tomorrow" (e.g. prep 40 steamed veg by 6pm) |
| **Prep forecasting** | Almost no one does per-slot prep forecasts for small QSRs | Core insight for momos, where wastage is real (steamed items don't hold) |
| **Leakage detection** | Reports exist, but no one surfaces them | Voids, discounts and cash variance per staff, pushed to your phone daily |
| **Cost** | Per-outlet subscriptions plus add-ons | Your own infra cost should be under ₹1,000/month (Phase 2 will confirm) |
| **Offline robustness** | Cloud POS often degrades when the internet drops | Local-first by design |
| **Owner control of data** | Exports are partial, lock-in | You own the DB |

---

## 2. Bluetooth thermal printing deep-dive (critical risk)

### 2.1 Bluetooth Classic (SPP) vs BLE: what cheap Indian printers use

- **Most low-cost 58mm printers sold in India** (HOIN H-58BT, generic "MTP-II"/"PT-210" clones, Everycom, Xprinter-based OEM boxes) **support Bluetooth Classic SPP**, and many listings say "BT 2.0/4.0" or "dual-mode". ⚠️ Listings rarely say which profiles they actually expose ([HOIN listing](https://www.dealsmagnet.com/deal/hoinb-usb-bluetooth-h-58bt-thermal-receipt-printer-18b6W7R4), [Everycom EC-58](https://marketplace.shakedeal.com/bluprints-sampann-2-inch-bluetooth-thermal-receipt-printer-dp1)).
- Some, like the **PT-210**, expose **both SPP and BLE**. The vendor SDK treats them as two transports carrying the same ESC/POS bytes ([PT-210 SDK docs](https://goojprt-pt210-sdk.readthedocs.io/en/latest/api/printer.html)).
- **SPP is faster.** Zebra's guidance is to use SPP for printing and BLE only for configuration. BLE works but has lower throughput, and you have to chunk writes (about 512 bytes max per characteristic write; often 20–180 bytes in practice depending on MTU) ([Zebra Developer](https://developer.zebra.com/content/printing-webapp-using-webbluetooth)).
- **Implication:** logos and Hindi text are sent as bitmaps (see §2.3), so the payload size makes BLE noticeably slower. On SPP a receipt prints in 1–2 s. On BLE with images it can take several seconds. ⚠️ (Measure this in milestone 1.)

**Recommendation:** buy a **dual-mode (SPP + BLE) printer** so both stacks stay open, but plan on SPP via native Android. If you're buying for the counter, prefer **mains-powered, with USB as a fallback**, and **80mm if counter space allows** (48 chars per line, easier to read, often has an auto-cutter and a cash-drawer port). 58mm is fine and cheaper. 💸 This is cheap to reverse (₹2–5k), but it decides which software stack works.

### 2.2 What a PWA can do vs a native Android app

| Capability | PWA (Chrome on Android) | PWA on iOS Safari | Native Android (Kotlin/Flutter/RN/Capacitor plugin) |
|---|---|---|---|
| BLE printing | ✅ Web Bluetooth | ❌ Not supported. WebKit opposes it ([W3C list, Sep 2024](https://lists.w3.org/Archives/Public/public-web-bluetooth/2024Sep/0002.html), [WebKit bug](https://bugs.webkit.org/show_bug.cgi?id=101034)) | ✅ |
| **Classic SPP printing** | ❌ Not possible. Web Bluetooth is GATT/BLE only ([WICG discussion](https://discourse.wicg.io/t/proposal-web-serial-api-bluetooth-support/5700)) | ❌ | ✅ RFCOMM socket, UUID `00001101-0000-1000-8000-00805F9B34FB` |
| Auto-reconnect without a tap | ⚠️ `requestDevice()` needs a user gesture. Silent reconnect to a previously granted device is limited and browser-version dependent | ❌ | ✅ Connect to bonded device by MAC address |
| Background or queued printing | ⚠️ Only while the tab is open and focused | ❌ | ✅ Foreground service and persistent print queue |
| USB printing fallback | ✅ WebUSB (Chrome) | ❌ | ✅ |
| Distribution and updates | ✅ Instant, no store | – | Play Store or sideloaded APK; OTA for JS-based stacks |

**Conclusion:** a pure PWA only works if (a) the printer has a reliable BLE mode and (b) you accept tapping "connect printer" after restarts. **That's too fragile when billing can never stop.** Phase 2 will compare native Kotlin, Flutter, React Native and a **Capacitor-wrapped web app with a native SPP plugin** (a hybrid: web UI plus native printing).

**Challenge to the "Android device" HYPOTHESIS:** I agree with it, and the research strengthens it. iOS is effectively ruled out for SPP printers. Recommended hardware: **8–10" Android tablet, Android 12 or newer**, kept on a charger. Android 12+ needs the `BLUETOOTH_CONNECT` and `BLUETOOTH_SCAN` runtime permissions, so handle those in onboarding.

### 2.3 ESC/POS command set: what we need

| Need | Command(s) | Notes for cheap printers |
|---|---|---|
| Init / reset | `ESC @` | Send at the start of every job |
| Bold, double height/width | `ESC E n`, `GS ! n` | Widely supported |
| Alignment | `ESC a n` | Widely supported |
| Line width | 58mm = 384 dots, **32 chars** (Font A) or about 42 (Font B). 80mm = 576 dots, **48 chars** | The layout engine must be width-aware |
| QR code (UPI QR, bill link) | `GS ( k` (native QR) | ⚠️ Many cheap clones **don't** support native QR. Fallback: render the QR as a bitmap |
| Logo | `GS v 0` raster (old but most widely supported). `GS ( L` is newer ([Epson ref](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_lv_0.html)) | Pre-dither to 1-bit, at most 384px wide. Keep it small (slow over BLE) |
| Paper cut | `GS V m` | Most 58mm portables **have no cutter** (tear bar). Many 80mm have one |
| Cash drawer kick | `ESC p m t1 t2` | Needs a printer with an RJ11 drawer port (usually 80mm desktop). A 58mm portable usually can't |
| Paper-out / status | `DLE EOT n` | ⚠️ Patchy on clones. Treat it as best-effort |
| Character sets | `ESC t n` code pages | Latin only in practice. **No Devanagari** |
| **Hindi / regional script** | **Render the text as an image (raster)** | Printers don't contain Indic fonts. Render on the device with a proper text shaper (Android's Canvas handles Devanagari conjuncts), then send as a bitmap ([thermal_unicode_print approach](https://pub.dev/packages/thermal_unicode_print)). Costs speed, so keep Hindi to item names only if you need it |

**Cross-printer gotcha:** the "same" ESC/POS command can behave differently across clone firmware. Keep a **printer profile** (width, QR native or bitmap, cutter yes/no, drawer yes/no, max chunk size, inter-chunk delay) instead of hard-coding.

### 2.4 Libraries by candidate stack (maintenance status)

| Stack | Library | SPP | BLE | Status / known issues |
|---|---|---|---|---|
| Native Android | **DantSu/ESCPOS-ThermalPrinter-Android** | ✅ | ❌ | About 1.3k★, single maintainer, last push about a year ago ([ecosyste.ms](https://sponsors.ecosyste.ms/accounts/dantsu)). Mature but slowing. Doesn't support Star printers. Thin enough to fork or vendor. |
| Native Android | Raw `BluetoothSocket` + own ESC/POS encoder | ✅ | ✅ (GATT) | Honestly the transport is about 200 lines. The encoder is the real work |
| Flutter | `unified_esc_pos_printer` | ✅ | ✅ | Classic, BLE, USB, network behind one API ([pub.dev](https://pub.dev/packages/unified_esc_pos_printer/versions/3.3.3/score)). Newer, check its issues |
| Flutter | `blue_thermal_printer` / `thermal_printer` | ✅ | partial | The original `thermal_printer` stopped getting updates, so forks appeared ([pub.dev](https://pub.dev/documentation/thermal_printer_plus/latest/)). ⚠️ Ecosystem churn |
| Flutter | `esc_pos_utils` / `esc_pos_gen` | (encoder only) | | Byte builder. `esc_pos_gen` marks `GS v 0` as obsolete but supports it ([pub.dev](https://pub.dev/packages/esc_pos_gen)) |
| React Native | `react-native-thermal-receipt-printer` and forks | ✅ | ⚠️ | ⚠️ Several abandoned forks. Not verified, so assume you'd need to maintain a fork |
| Capacitor (web UI + native) | `@delicity/capacitor-thermal-printer`, `Glavotaner/bluetooth-serial` | ✅ | ✅ / ❌ | Small projects. The Delicity repo lists SPP, BLE, USB and TCP ([repo](https://raw.githubusercontent.com/kevinfavv/CapacitorThermalPrinter/HEAD/CONTRIBUTING.md)). ⚠️ Low adoption. A custom 1-file plugin is a realistic fallback |
| Web (PWA) | **@point-of-sale/receipt-printer-encoder** + `webbluetooth-receipt-printer` (Niels Leenheer) | ❌ | ✅ | Best-in-class **encoder** (ESC/POS, StarPRNT, images, QR, code pages) ([README](https://unpkg.com/@point-of-sale/receipt-printer-encoder@3.0.3/README.md)). **The encoder is reusable inside a Capacitor app even if the transport is native SPP.** |

**Opinion:** the bytes are simple. Fragility comes from the *transport and its lifecycle*. Whatever stack wins, we should own the transport layer (connect, retry, chunk, queue) rather than depend on a lightly maintained wrapper.

### 2.5 Pairing, reconnection and "printer went to sleep"

Failure modes to design for (each needs a test in milestone 1):

| Failure | Cause | Handling |
|---|---|---|
| Printer asleep / off | Battery printers auto-sleep after N minutes | Prefer mains power. Otherwise, connect on print with 2–3 retries and backoff (about 0.5s, 1.5s, 3s), then show "Printer offline: tap to retry" without blocking billing |
| Socket stale after idle | SPP sockets silently die | Don't hold a socket forever. Open per job (cheap on SPP, about 0.5–1s) or keepalive with health checks. Measure which is faster on the real printer |
| Paper out / cover open | | `DLE EOT` if supported. Otherwise detect a write error. Job stays in the queue |
| Out of range / BT off on tablet | | Detect the adapter state, prompt to enable BT |
| Wrong printer paired | Several printers nearby (neighbouring shops!) | Pin the printer by MAC address in settings, show its name on screen |
| Partial print | Disconnect mid-job | **Persistent print queue**: job states `queued → sending → done/failed`. Failed jobs can be reprinted. Never lose the bill, even if paper output fails |
| Android kills app | Battery optimisation | Ask to exempt from battery optimisation. Foreground service while open |

**Principle:** the bill gets written to the local DB **before** printing. Printing is a side effect that can fail and be retried, and it never blocks the next order.

---

## 3. Indian compliance (GST, FSSAI)

> ⚠️ I'm not a CA. Everything here should be confirmed with your accountant before we lock the receipt layout.

### 3.1 Which scheme are you on? (this changes the bill) 💸

| Situation | Document | Tax on bill | Notes |
|---|---|---|---|
| **Unregistered** (turnover under ₹20 lakh for services; ₹10 lakh in special-category states) | Plain bill / cash memo | None. **Must not** show GST | Registration only becomes mandatory above the threshold ([Kanakkupillai](https://www.kanakkupillai.com/learn/gst-for-cloud-kitchens-in-india/)) |
| **Regular scheme**, standalone restaurant | **Tax invoice** | **5% (CGST 2.5% + SGST 2.5%), no ITC**. SAC 996331 | After the Sept 2025 rate rationalisation, standalone restaurants stay at 5% without ITC. 18% with ITC applies only to "specified premises" (hotels with room tariff ₹7,500 or more) ([Bajaj Finserv](https://www.bajajfinserv.in/gst-on-restaurant), [Restaurant India](https://www.restaurantindia.in/news/gst-council-cuts-tax-rate-for-restaurants.n15008)) ⚠️ |
| **Composition scheme** (turnover up to ₹1.5 cr; ₹75 lakh in special-category states) | **Bill of supply** | **No tax shown, can't collect GST from the customer**. You pay 5% of turnover yourself | Must print "composition taxable person, not eligible to collect tax on supplies" ([ClearTax](https://cleartax.in/s/gst-composition-scheme-restaurants), [GST Council flyer](https://www.gstcouncil.gov.in/sites/default/files/e-version-gst-flyers/Tax_Invoice_and_other_new.pdf)). ⚠️ Whether selling via Swiggy/Zomato affects composition eligibility is **genuinely unsettled** ([TaxTMI thread](https://www.taxtmi.com/forum/issue?id=119786)), so ask your CA |

**Design implication:** the "tax mode" (unregistered, regular or composition) is a **business setting with an effective date**, and every bill stores the tax mode used. We never recompute old bills from current settings.

### 3.2 Mandatory fields on a tax invoice (Rule 46, CGST Rules)

Per [Rule 46 (CBIC)](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html) and [ClearTax summary](https://cleartax.in/s/gst-invoice-details), the ones that apply to a B2C counter bill:

1. Supplier **name, address, GSTIN**
2. **Invoice serial number**: consecutive, **at most 16 characters**, letters, digits, `-` and `/` allowed, **unique per financial year**, one or more series allowed
3. **Date of issue**
4. Recipient name/address: **only needed for unregistered B2C if the value is ₹50,000 or more**, which never happens for you. Recipient GSTIN if the customer is a registered business (B2B), so support an optional "GST bill" toggle
5. **HSN/SAC** (SAC 996331 for restaurant service). ⚠️ HSN digits on B2C invoices depend on turnover, so confirm with your CA
6. Description, quantity, **taxable value** (after discount)
7. **Rate and amount of CGST and SGST** shown separately
8. **Place of supply** (state). For a counter, it's your state
9. Whether tax is payable on **reverse charge** (No)
10. Signature or digital signature: ⚠️ commonly treated as not required for computer-generated invoices, but confirm

**Small-value relief:** Rule 46 lets a registered supplier skip individual tax invoices for supplies **under ₹200** to unregistered customers who don't ask for one, issuing **one consolidated invoice at the end of the day** instead. ⚠️ **Recommendation: don't rely on this.** Print a proper bill for every order. It's cleaner for audit, insights and customer trust.

**Bill of supply (composition):** similar fields minus the tax lines, plus the composition declaration.

### 3.3 Invoice numbering (critical for offline) 💸

- Has to be **unique and consecutive within a series per financial year** (1 Apr–31 Mar). A fresh series each FY is standard practice ([GSTN advisory via Masters India](https://www.mastersindia.co/blog/gstn-issues-advisory-to-start-new-invoice-series/), [IRIS GST](https://irisgst.com/effective-1st-april-2026-reset-the-invoice-number-series/)).
- **Multiple series are allowed.** That's the clean answer for offline and multi-device: each device or till gets its **own series prefix** and numbers locally with no server round-trip. Example: `MC/T1/2627/000123` is 17 characters, too long. `T1-2627-00123` is 13 ✅.
- **Gaps are an audit red flag.** A voided bill **keeps its number** and is printed or kept as "VOID". Numbers are never reused or skipped.
- The bill's internal ID (a UUID for sync) is **separate** from the legal invoice number.

### 3.4 Data retention

- Keep books and records for **72 months from the due date of the annual return** for that year (about 7–8 years in practice). This is **CGST Act Section 36** ⚠️ (from my knowledge; the search didn't surface the primary text, so verify).
- Implication: bills can **never be hard-deleted**. Backups must be durable for 8 years or more. Exports need to be readable by your CA (CSV/Excel).

### 3.5 FSSAI

- The **14-digit FSSAI licence or registration number must be printed** on bills, cash memos and receipts. This was ordered in June 2021, enforced from **1 Jan 2022** after a postponement from 1 Oct 2021, and reiterated in 2022 ([TaxGuru](https://taxguru.in/corporate-law/fssai-food-businesses-mention-license-no-invoices-w-e-f-1st-october-2021.html), [FoodSafetyWorks](https://foodsafetyworks.com/news/fssai-order-mandatory-declaration-of-fssai-license-registration-number-on-cash-receipts-invoices-cash-memo-bills-etc-by-all-food-businesses/)).

### 3.6 Not applicable (for now)

- **E-invoicing (IRN)**: applies to B2B invoices for businesses above the AATO threshold, and B2C is exempt ⚠️. Not relevant at your scale.
- **B2C dynamic QR on invoices**: only for very large taxpayers ⚠️. Not relevant. We'll still print a UPI QR for payment, which is a separate thing.

---

## 4. Payments

### 4.1 Options

| Option | Cost | Auto-confirmation? | Works offline? | Notes |
|---|---|---|---|---|
| **Static QR** (your current shop QR / standee) | Free | ❌ Staff checks the customer's phone or a soundbox | ✅ | Fraud risk: fake "payment success" screenshots. Soundbox fixes most of it |
| **Amount-prefilled UPI QR generated on the device** (`upi://pay?pa=<merchant VPA>&am=<amt>&tn=<bill no>`) | Free | ❌ | ✅ (QR generated locally) | Customer doesn't type the amount, so fewer errors. Can print it on the bill or show it on screen. ⚠️ Some UPI apps restrict amount-prefilled intents to *personal* VPAs, so use a **merchant** VPA |
| **Dynamic QR via payment gateway** (Razorpay, Cashfree, PhonePe PG, Paytm) | Gateway platform fee ⚠️ (quote needed) + MDR | ✅ Webhook / poll marks the bill paid ([Razorpay QR docs](https://razorpay.com/docs/payments/qr-codes/how-it-works)) | ❌ Needs internet to create the QR and receive the webhook | Best UX when online. Falls back to the static or local QR when offline |
| **Soundbox** (PhonePe SmartSpeaker, Paytm, Google Pay SoundPod) | PhonePe: ₹318 setup + ₹125/month, or ₹999 + ₹25/month ([PhonePe help](https://cms.phonepe.com/en/mx/merchant-help/phonepe-smartspeaker/about-phonepe-smartspeaker/what-are-charges-applicable-phonepe-smartspeaker)) | Audio only | ✅ (has its own 4G SIM) | **No public API** to get the payment into the POS ([search found none](https://www.phonepe.com/press/phonepe-launches-smart-speaker-for-reliable-convenient-payment-tracking-at-stores/)). Great human check, useless for automation |
| **Card** (optional) | MDR about 1–2% ⚠️ + device rental | Via the terminal's own app | Partially | Recommend **Later**. Low demand at a momo counter |

### 4.2 MDR on UPI ✅

- **From 15 Oct 2026**, per NPCI's FAQ, P2M UPI payments **above ₹2,000 carry 0.4% MDR** (capped at ₹300). **Payments of ₹2,000 or less (over 95% of P2M volume) stay at zero MDR.** Merchants **can't add a surcharge** to the customer ([NPCI FAQ](https://www.npci.org.in/uploads/FA_Qs_Merchant_Discount_Rate_MDR_on_Select_UPI_P2_M_Transactions_58dba1d39e.pdf), [Entrepreneur India](https://india.entrepreneur.com/business-news/npci-announces-0-4-mdr-on-upi-transactions-above-inr-2000)). Small merchants receiving up to ₹1 lakh/month via QR may stay at zero under the P2PM framework ([SMFG](https://www.smfgindiacredit.com/knowledge-center/upi-charges-2026-new-mdr-rules-and-transaction-fees.aspx)).
- ⚠️ I couldn't find a post-launch confirmation that it went live exactly on 15 Oct. Verify with your bank or PSP.
- **For you:** average momo bills are well under ₹2,000, so **UPI MDR ≈ ₹0**. **Gateway platform fees are a separate cost** that stacks on top (Razorpay's own guide says so, plus 18% GST on fees) ([Razorpay blog](https://razorpay.com/blog/upi-mdr-for-merchants-in-payment-gateway-explained/)). ⚠️ Get quotes. Some PGs offer 0% on UPI for small merchants, some don't.

### 4.3 Recommendation

- **V1:** cash + UPI with an **amount-prefilled QR shown on screen and printed on the bill** (free, offline), plus a **"Mark paid: UPI"** one-tap, with your soundbox as the human check.
- **V2:** add a gateway dynamic QR for **automatic confirmation** when online, which also gives you clean UPI reconciliation data. Pick a PG whose UPI pricing is 0% or near-0 at your ticket size.
- **Reconciliation regardless:** import the bank/PSP settlement statement (CSV) to match UPI totals per day. That's V2, and it's how we catch "screenshot fraud".

---

## 5. Aggregator orders (Swiggy / Zomato)

- **Direct API access is effectively closed** to self-built POS systems. Both platforms integrate with a list of **approved POS partners**, and orders flow through middleware like **UrbanPiper** (in which Swiggy and Zomato are investors). UrbanPiper's onboarding expects an active aggregator partnership, GST details, and a menu that matches across channels ([UrbanPiper Swiggy docs](https://help.urbanpiper.com/ordering-channels/swiggy/getting-started), [Gofrugal–UrbanPiper guide](https://community.gofrugal.com/portal/en/kb/articles/urban-piper-i)). ⚠️ UrbanPiper can push orders into *partner* POS systems. Whether they'd onboard a one-outlet custom POS (and at what price) is unknown.
- **Tax twist ✅:** since 1 Jan 2022, under **Section 9(5)** the aggregator pays the 5% GST on restaurant orders it delivers. You don't charge GST on those, and you report them separately (GSTR-3B Table 3.1.1) ([TaxBuddy](https://www.taxbuddy.com/blog/supplies-u-s-9-5), [CleverCoins](https://clevercoins.org/?p=11257)).

**Options:**

| Option | Effort | Cost | Verdict |
|---|---|---|---|
| A. Keep the aggregator tablet. **Quick-enter** each order into the POS as channel=Swiggy/Zomato with their order ID (KOT + stock + insights) | Low | ₹0 | **V1** |
| B. Import aggregator **payout/order reports** (CSV/Excel from partner dashboards) daily or weekly for reconciliation and commission analysis | Medium | ₹0 | **V2** |
| C. Middleware (UrbanPiper etc.) pushing orders into our POS via their API | High + partner approval | Subscription ⚠️ | **Later**, only if aggregator volume is large |
| D. Scrape partner apps or notifications | – | – | **No.** Brittle and likely against ToS |

**Data model must-have now:** `order.channel` (counter / Swiggy / Zomato / phone), `external_order_id`, and **tax treatment per order** (e.g. `tax_collected_by = merchant | eco_9_5`). Adding this later means re-classifying history. 💸

---

## 6. Everything else a good counter POS needs

| Feature | V1 / V2 / Later | Reason |
|---|---|---|
| **Item grid + one-tap add, quantity +/-** | **V1** | Under-5-taps target |
| **Variants** (Veg/Chicken/Paneer; Steamed/Fried/Tandoori/Kurkure; Half/Full plate) | **V1** | This *is* a momo menu. Model variants properly, or the item list explodes and insights get muddy 💸 |
| **Modifiers / add-ons** (extra mayo, extra chutney, less spicy, no onion) | **V1** | Very common. Free-text note plus priced add-ons |
| **Combos** (momo + drink) | **V1** (fixed combos), **V2** (combo builder) | Combos drive AOV, and combo insights need combo lines modelled |
| **KOT (kitchen order ticket)** | **V1** | Print a KOT (or a second copy) for the momo steamer/wok station. ⚠️ Is your kitchen a separate station? |
| **Token / order number** on the bill | **V1** | Counter pickup flow: "Token 42" |
| **Order types**: takeaway / dine-in / aggregator / phone | **V1** | Needed for tax (§5) and insights |
| **Payment: cash, UPI, split payment** | **V1** | Split (part cash, part UPI) is common |
| **Change calculator** for cash | **V1** | Speed + fewer errors |
| **Discounts** (₹ or %, with reason, permission-gated) | **V1** | Leakage control |
| **Void / cancel with reason + staff + timestamp; no delete** | **V1** | Compliance + leakage insight 💸 |
| **Refund** (full/partial) as a separate document | **V1** (simple) | Rare but must be auditable |
| **Receipt reprint** (marked "DUPLICATE") | **V1** | Printer failures, customer asks |
| **Day open / day close (Z-report)** with **cash count + variance** | **V1** | Core cash reconciliation |
| **Opening float, cash in/out (petty expenses)** | **V1** | Or cash variance is meaningless |
| **Staff login (PIN) + roles** (owner, cashier) | **V1** | Attribution for every action |
| **Offline-first + background sync** | **V1** | LOCKED requirement |
| **Automatic cloud backup + local export** | **V1** | Records for 72 months 💸 |
| **Menu management** (price changes, item on/off "86'd") | **V1** | Price history must be kept: bills store the price at time of sale |
| **Basic dashboard** (today's sales, payment mix, top items, hourly) | **V1** | Insights are core |
| **Daily summary on WhatsApp/Telegram** | **V1** (Telegram is easy) / **V2** (WhatsApp Business API costs + template approval) | You want insights pushed, not pulled |
| **Item cost input** (for margin) | **V1** (manual cost per item) | Needed for contribution margin. Recipe costing comes later |
| **Customer phone capture** (optional, one field) | **V1** (optional field) / **V2** (loyalty) | Enables repeat-customer insight. ⚠️ DPDP Act 2023: get consent, state purpose |
| **GST B2B bill** (customer GSTIN) | **V1** (toggle) | Occasional office orders |
| **Historical sales import** | **V1.5**, depends on export format | Gives forecasting a head start. Need a sample file |
| **Prep forecasting** | **V2** | Needs 4–8 weeks of clean, slot-level data first (or imported history) |
| **Item affinity / combo suggestions** | **V2** | Needs volume. Simple co-occurrence is fine |
| **LLM narrative insights** | **V2** | After deterministic metrics are trusted |
| **Stock / raw material tracking** (dough, filling, oil, packaging) | **V2** | High effort, high value for wastage. Start with end-of-day "plates wasted" entry in V1? (⚠️ open question) |
| **Recipe / BOM costing** | **V2/Later** | Needs stock first |
| **Purchase / vendor management** | **Later** | Use Khatabook/Excel meanwhile |
| **Aggregator report import** | **V2** | §5 |
| **Gateway dynamic QR auto-confirm** | **V2** | §4 |
| **Bank/UPI settlement reconciliation** | **V2** | Screenshot-fraud detection |
| **Loyalty / coupons** | **Later** | Not a must-have for a counter |
| **Customer display / QR self-order** | **Later** | Nice, not needed |
| **Cash drawer kick** | **Later** (hardware-dependent) | 58mm portables usually have no drawer port |
| **Weather / festival effects** | **V2** (as forecast features) | Agree with your hypothesis. Cheap to add once forecasting exists |
| **Multi-outlet / multi-tenant SaaS** | **Later**, but **design IDs and schema to allow it** | Adding `outlet_id` later is painful 💸 |
| **Card payments** | **Later** | Low demand |
| **Crash reporting + print failure logs** | **V1** | Can't fix what you can't see |

---

## 7. Hypotheses: validated or challenged

| Hypothesis | Verdict | Why |
|---|---|---|
| Android phone/tablet at the counter | ✅ **Supported, strengthened** | iOS can't do SPP printing from web and has no Web Bluetooth. Recommend a **tablet (8–10")**, not a phone: bigger grid means fewer mis-taps |
| Generic 58mm BT ESC/POS printer | ⚠️ **Partly challenged** | Fine, but **choose it deliberately**: mains-powered, dual-mode BT, USB fallback. **Consider 80mm** if you want a cutter, a drawer port and readability |
| Users: Shrey + 1–2 staff | ✅ Plausible | Drives roles: owner + cashier is enough for V1 |
| Single outlet; maybe multi-outlet/product later | ✅ | Single-outlet product, but **multi-outlet-safe IDs and schema** (cheap now, expensive later) |
| Historical exports to import | ❓ **Unknown** | Need a sample file and a list of fields to judge |
| Volume ~100–300 bills/day | ✅ Plausible | Tiny for any DB. Sizing isn't a constraint, but reliability is |

---

## 8. Expensive-to-reverse decisions (flagged for Phase 2/3)

1. Native vs web transport for printing (printer purchase and client stack)
2. Invoice number format and series-per-device scheme
3. Tax mode as a dated setting, and per-order tax treatment (aggregator 9(5))
4. Variant/modifier/combo data model
5. Immutable bills (void, never delete) and price-at-time-of-sale
6. UUID-based IDs plus `outlet_id` everywhere (future multi-outlet)
7. Where the source of truth lives (device-first with sync vs server-first)

---

## Open questions for Shrey

**Business and compliance**
1. Are you **GST-registered**? If yes, **regular or composition**? Can you share a current bill (photo) so I can see what your CA approved?
2. What's your **FSSAI number type** (registration or licence)? And which **state** (for place of supply)?
3. Approximate **annual turnover band** (under ₹20L / ₹20L–1.5Cr / above)? It decides scheme options.
4. Roughly what **share of orders is Swiggy/Zomato**? Are you on both? Is the aggregator tablet at the same counter?

**Current POS**
5. Which POS do you use now, and what are the **top 5 things you hate** about it? (This is the best competitive data we'll get.)
6. Can you share a **sample historical export** (even 1 week)? What fields and format (CSV/XLSX)? How many months of history?

**Counter operations**
7. **Is the kitchen a separate station** that needs a KOT, or does the person at the counter also cook? One printer or two?
8. How many **menu items** (including variants)? Can you share the menu (photo is fine)?
9. Typical **peak**: how many orders per hour at the busiest slot? How many people at the counter then?
10. Do staff currently **give discounts**? Who's allowed to? Do you want a PIN for voids and discounts?
11. Do you take **phone orders** / pay-later / credit (khata) customers?

**Hardware**
12. Do you **already own** a printer and tablet? If yes, the exact model (photo of the label). If not, are you OK buying a **mains-powered dual-mode printer** (about ₹2.5–5k for 58mm, ₹4–8k for 80mm ⚠️) and an Android tablet?
13. Is a **cash drawer** wanted? (It pushes us towards 80mm.)
14. Is **Hindi (or another script) on the bill** needed, or is English fine?

**Payments**
15. Which **UPI provider / bank** is your current QR on? Do you have a soundbox?
16. Is **automatic UPI confirmation** worth a gateway fee to you, or is the soundbox check good enough for V1?

**Insights and delivery**
17. Preferred daily summary channel: **WhatsApp or Telegram**? (Telegram is free and quick to build. WhatsApp Business API has per-message costs and template approvals.)
18. Do you track **wastage** today (e.g. plates left at close)? Would staff enter it at day close?
19. Comfort with **customer phone capture** at the counter (consent required under the DPDP Act)?

**Scope**
20. How serious is the "**product for other outlets**" idea: a 12-month goal, or a someday? It shifts how much multi-tenant groundwork goes into V1.
21. Is **this repo (`careerdestiny-web`) the right home** for these docs, or should the POS get its own repository?
