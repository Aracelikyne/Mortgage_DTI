import { describe, it, expect } from "vitest";
import { buildStatementPlan, nameSimilarity, needsInfo, reviewItems, resolveReview, statementAsOfGuess } from "./statementSync";
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

describe("no duplicates", () => {
  const sheet = (names) => [["Bill", "Monthly", "Due", "Payoffs", "APR"], ...names.map((n) => [n, "US$50.00", "10", "US$500.00", "20"])];
  const map = { name: 0, monthly: 1, dueDay: 2, balance: 3, apr: 4 };
  const run = (names, siteDebts, picks) => buildStatementPlan({ rows: sheet(names), headerRow: 0, mapping: map, debts: siteDebts, fixed: [], asOf: "2026-10-31", by: "Sadler", picks });
  const site = [
    { id: "amex", name: "Amex Blue Cash", monthly: 50, dueDay: 10, balance: 600, apr: 20 },
    { id: "sk-egg", name: "Best Egg (SK)", monthly: 50, dueDay: 10, balance: 600, apr: 20 },
    { id: "cap", name: "Capital One", monthly: 50, dueDay: 10, balance: 600, apr: 20 },
    { id: "nfcu", name: "Navy Federal", monthly: 50, dueDay: 10, balance: 600, apr: 20 },
  ];

  it("suggests the closest-named bill instead of adding a new one", () => {
    const plan = run(["AMEX", "SK Best Egg", "Cap 1"], site);
    expect(plan.filter((p) => p.rowNumber).map((p) => [p.name, p.kind, p.existingId, p.matchedBy])).toEqual([
      ["AMEX", "update", "amex", "suggested"],
      ["SK Best Egg", "update", "sk-egg", "suggested"],
      ["Cap 1", "update", "cap", "suggested"],
    ]);
    expect(plan.filter((p) => p.kind === "new")).toEqual([]);
  });

  it("asks rather than guesses when no name is close, and offers every unmatched bill", () => {
    const [row] = run(["NFCU CC"], site);
    expect(row.kind).toBe("new");
    expect(row.choices.map((c) => c.id).sort()).toEqual(["amex", "cap", "nfcu", "sk-egg"]);
  });

  it("follows the person's pick, and 'new' when they say so", () => {
    const picked = run(["NFCU CC"], site, { 0: "nfcu" });
    expect(picked[0]).toMatchObject({ kind: "update", existingId: "nfcu", matchedBy: "picked" });
    expect(picked.some((p) => p.kind === "missing" && p.existingId === "nfcu")).toBe(false);
    expect(run(["AMEX"], site, { 0: "new" })[0].kind).toBe("new");
  });

  it("never matches two rows to the same bill", () => {
    const plan = run(["Capital One", "Cap 1"], site, { 1: "cap" });
    expect(plan[0]).toMatchObject({ kind: "update", existingId: "cap", matchedBy: "name" });
    expect(plan[1].selected).toBe(false);
    expect(plan[1].problems[0]).toMatch(/already matched/);
    expect(plan[1].choices.some((c) => c.id === "cap")).toBe(false);
  });

  it("skips a bill listed twice in the file", () => {
    const plan = run(["Navy Federal", "navy federal"], site);
    expect(plan[1]).toMatchObject({ kind: "skip", selected: false });
    expect(plan[1].problems[0]).toMatch(/listed twice — row 2/);
  });

  it("running the same import again adds nothing", () => {
    const first = run(["Brand New Loan"], site);
    const added = { id: "x", ...first[0].fields };
    const again = run(["Brand New Loan"], [...site, added]);
    expect(again[0]).toMatchObject({ kind: "update", existingId: "x", matchedBy: "name" });
    expect(again.filter((p) => p.kind === "new")).toEqual([]);
  });

  it("remembers a matched statement name, so the next import lines up by itself", () => {
    const first = run(["NFCU CC"], site, { 0: "nfcu" });
    expect(first[0].patch.statementNames).toEqual(["NFCU CC"]);
    const updated = site.map((d) => (d.id === "nfcu" ? { ...d, ...first[0].patch } : d));
    expect(run(["NFCU CC"], updated)[0]).toMatchObject({ kind: "update", existingId: "nfcu", matchedBy: "name" });
  });

  it("scores names", () => {
    expect(nameSimilarity("SK Best Egg", "Best Egg (SK)")).toBe(1);
    expect(nameSimilarity("MAK Cap2", "Mak Capital 2")).toBe(1);
    expect(nameSimilarity("Tires", "Kayak")).toBe(0);
  });
});

describe("statement date", () => {
  it("a 'November 2026' title means payoffs are good through October 31", () => {
    expect(statementAsOfGuess(rows, 1, new Date(2026, 9, 25))).toBe("2026-10-31");
  });
  it("falls back to today with no title", () => {
    expect(statementAsOfGuess([["Bill"]], 0, new Date(2026, 9, 25))).toBe("2026-10-25");
  });
  it("stamps the payoff date and when it was updated separately", () => {
    const p = buildStatementPlan({ rows, headerRow, mapping, debts, fixed, asOf: "2026-10-31", updatedOn: "2026-10-25", by: "Sadler" });
    expect(p.find((x) => x.name === "Card B").patch).toMatchObject({ balanceAsOf: "2026-10-31", balanceUpdatedAt: "2026-10-25", balanceUpdatedBy: "Sadler" });
  });
});
