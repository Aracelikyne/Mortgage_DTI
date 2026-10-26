import { describe, it, expect } from "vitest";
import { buildStatementPlan, needsInfo, reviewItems, resolveReview } from "./statementSync";
import { autoMapColumns, detectHeaderRow } from "./importParse";

const rows = [
  ["November 2026", "", "", "", ""],
  ["Bill", "Monthly", "Due Date (day of month)", "Payoffs", "APR. "],
  ["Card A", "US$57.00", "11", "US$764.00", ""],
  ["Card B", "US$234.00", "16", "US$7530.00", "27.99"],
  ["Car", "US$720.00", "26", "", ""],
  ["New Loan", "US$100.00", "3", "US$900.00", "12.5"],
  ["Rent", "US$2589.00", "1", "", ""],
  ["Childcare", "US$1360.00", "1", "", ""],
];
const debts = [
  { id: "a", name: "Card A", monthly: 60, dueDay: 11, balance: 800, apr: 24.99 },
  { id: "b", name: "Card B", monthly: 234, dueDay: 15, balance: 7700, apr: 28 },
  { id: "c", name: "Car", monthly: 720, dueDay: 26, balance: 31000, apr: 6.9 },
  { id: "z", name: "Old Card", monthly: 20, dueDay: 5, balance: 100, apr: 20 },
];
const fixed = [{ id: "r", name: "Rent", monthly: 2589, dueDay: 1 }];
const headerRow = detectHeaderRow(rows);
const mapping = autoMapColumns(rows[headerRow], "statement");
const plan = buildStatementPlan({ rows, headerRow, mapping, debts, fixed, asOf: "2026-10-25", by: "Sadler" });
const byName = (n) => plan.find((p) => p.name === n);

describe("buildStatementPlan", () => {
  it("finds the header row under the month title and maps the columns", () => {
    expect(headerRow).toBe(1);
    expect(mapping).toEqual({ name: 0, monthly: 1, dueDay: 2, balance: 3, apr: 4 });
  });

  it("takes the statement payoff and restarts the payments-since clock", () => {
    expect(byName("Card A").patch).toMatchObject({ balance: 764, balanceAsOf: "2026-10-25", balanceUpdatedBy: "Sadler" });
  });

  it("keeps an APR the statement doesn't have, flagged for review", () => {
    expect(byName("Card A").patch.apr).toBeUndefined();
    expect(byName("Card A").patch.review.apr).toEqual({ missingOnStatement: true, current: 24.99 });
  });

  it("flags a different monthly payment instead of changing it", () => {
    expect(byName("Card A").patch.monthly).toBeUndefined();
    expect(byName("Card A").patch.review.monthly).toEqual({ statement: 57, current: 60 });
  });

  it("takes the statement APR and flags a different due day", () => {
    const b = byName("Card B").patch;
    expect(b.apr).toBe(27.99);
    expect(b.review.dueDay).toEqual({ statement: 16, current: 15 });
    expect(b.review.monthly).toBeUndefined();
  });

  it("clears the payoff when the statement has none, so it reads as needing info", () => {
    const c = byName("Car").patch;
    expect(c.balance).toBeNull();
    expect(needsInfo({ ...debts[2], ...c })).toEqual(["payoff"]);
  });

  it("adds bills the app doesn't have — rent/childcare as fixed expenses", () => {
    expect(byName("New Loan")).toMatchObject({ kind: "new", target: "debts", fields: { balance: 900, apr: 12.5, monthly: 100, dueDay: 3, balanceAsOf: "2026-10-25" } });
    expect(byName("Childcare")).toMatchObject({ kind: "new", target: "fixed", fields: { type: "Childcare", monthly: 1360, dueDay: 1 } });
  });

  it("matches fixed expenses too, without touching payoff fields", () => {
    expect(byName("Rent")).toMatchObject({ kind: "update", target: "fixed" });
    expect(byName("Rent").patch.balance).toBeUndefined();
  });

  it("flags app bills that aren't on the statement instead of deleting them", () => {
    expect(byName("Old Card")).toMatchObject({ kind: "missing", patch: { review: { notOnStatement: true } } });
  });
});

describe("review flags", () => {
  it("lists flags and resolves them", () => {
    const item = { ...debts[0], ...byName("Card A").patch };
    expect(reviewItems(item).map((r) => r.key)).toEqual(["monthly", "apr"]);
    expect(resolveReview(item, "monthly", true)).toEqual({ monthly: 57, review: { apr: { missingOnStatement: true, current: 24.99 } } });
    expect(resolveReview(item, "monthly", false)).toEqual({ review: { apr: { missingOnStatement: true, current: 24.99 } } });
  });
});
