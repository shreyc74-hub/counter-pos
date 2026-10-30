import type { CashMovement, DaySession, DayTotals, Expense, Order } from "./types";

/** "T1-000124". Each device owns its own series, so offline devices never clash. */
export function formatBillNo(deviceCode: string, seq: number): string {
  return `${deviceCode}-${String(seq).padStart(6, "0")}`;
}

/** Business date in the outlet's timezone (India), YYYY-MM-DD. */
export function businessDate(d: Date = new Date(), timeZone = "Asia/Kolkata"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts; // en-CA formats as YYYY-MM-DD
}

/** A bill with nothing paid yet (a dine-in bill saved as "Not paid"). */
export function isUnpaid(o: Order): boolean {
  return !o.voided && o.payments.length === 0;
}

export function computeDayTotals(
  day: DaySession,
  orders: Order[],
  expenses: Expense[],
  movements: CashMovement[],
): DayTotals {
  const live = orders.filter((o) => !o.voided);
  const voided = orders.filter((o) => o.voided);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const paid = (method: "cash" | "upi") =>
    sum(live.flatMap((o) => o.payments.filter((p) => p.method === method).map((p) => p.amountPaise)));

  const cashSales = paid("cash");
  const upiSales = paid("upi");
  const expenseCash = sum(expenses.filter((e) => e.method === "cash").map((e) => e.amountPaise));
  const expenseUpi = sum(expenses.filter((e) => e.method === "upi").map((e) => e.amountPaise));
  const cashIn = sum(movements.filter((m) => m.direction === "in").map((m) => m.amountPaise));
  const cashOut = sum(movements.filter((m) => m.direction === "out").map((m) => m.amountPaise));

  return {
    orders: live.length,
    salesPaise: sum(live.map((o) => o.totalPaise)),
    cashSalesPaise: cashSales,
    upiSalesPaise: upiSales,
    voids: voided.length,
    voidedPaise: sum(voided.map((o) => o.totalPaise)),
    discountsPaise: sum(live.map((o) => o.discount?.amountPaise ?? 0)),
    expenseCashPaise: expenseCash,
    expenseUpiPaise: expenseUpi,
    cashInPaise: cashIn,
    cashOutPaise: cashOut,
    unpaidCount: live.filter(isUnpaid).length,
    unpaidPaise: sum(live.filter(isUnpaid).map((o) => o.totalPaise)),
    expectedCashPaise: day.openingFloatPaise + cashSales + cashIn - expenseCash - cashOut,
  };
}
