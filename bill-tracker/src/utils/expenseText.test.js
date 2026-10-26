import { describe, it, expect } from "vitest";
import { parseTransactionText } from "./expenseText";

const TODAY = new Date(2026, 9, 25, 15, 0); // Sunday, October 25, 2026

describe("parseTransactionText", () => {
  it("reads an Apple Wallet transaction screenshot", () => {
    const text = "9:41\nCostco Wholesale\n$64.12\nPending\nApple Card\nOct 20, 2026 at 3:15 PM\nDaily Cash $1.28\nReport an Issue";
    expect(parseTransactionText(text, TODAY)).toEqual({ amount: 64.12, refund: false, merchant: "Costco Wholesale", date: "2026-10-20" });
  });

  it("understands Wallet's relative dates", () => {
    expect(parseTransactionText("Shell\n$41.00\nYesterday", TODAY).date).toBe("2026-10-24");
    expect(parseTransactionText("Chipotle\n$18.40\nThursday", TODAY).date).toBe("2026-10-22");
    expect(parseTransactionText("Target\n$5.00\nToday", TODAY).date).toBe("2026-10-25");
    expect(parseTransactionText("Target\n$5.00\nDec 30", new Date(2027, 0, 3)).date).toBe("2026-12-30");
  });

  it("takes a receipt's TOTAL over the line items, subtotal and tax", () => {
    const text = "WINCO FOODS #12\n10/21/26\nMILK 3.49\nBREAD 2.99\nSUBTOTAL 6.48\nTAX 0.45\nTOTAL $6.93\nTHANK YOU";
    expect(parseTransactionText(text, TODAY)).toEqual({ amount: 6.93, refund: false, merchant: "WINCO FOODS", date: "2026-10-21" });
  });

  it("flags a refund", () => {
    expect(parseTransactionText("Amazon\n-$22.99\nRefund", TODAY)).toMatchObject({ amount: 22.99, refund: true, merchant: "Amazon" });
  });

  it("returns blanks when nothing's readable", () => {
    expect(parseTransactionText("", TODAY)).toEqual({ amount: null, refund: false, merchant: "", date: null });
  });
});
