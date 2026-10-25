import { describe, it, expect } from "vitest";
import {
  parseDelimited, parseMoney, parsePercent, parseDate, parseDueDay, parseTier, matchOption,
  detectHeaderRow, autoMapColumns, buildPreview, markDuplicateExpenses, newDebtFrom, patchFrom, columnLabels,
} from "./importParse";
import { CATEGORY_OPTIONS } from "../data/constants";

describe("parseDelimited", () => {
  it("reads cells copied from Numbers (tab-separated)", () => {
    const text = "Name\tBalance\tMin Payment\nAmex\t$3,400.00\t$120.00\nExpedia\t$900.40\t$45.00\n";
    expect(parseDelimited(text)).toEqual([["Name", "Balance", "Min Payment"], ["Amex", "$3,400.00", "$120.00"], ["Expedia", "$900.40", "$45.00"]]);
  });

  it("handles CSV quoting: commas, escaped quotes and newlines inside cells", () => {
    const text = 'Name,Note,Amount\r\n"Smith, J.","said ""hi""\nthen left","$1,200.50"\r\n';
    expect(parseDelimited(text)).toEqual([["Name", "Note", "Amount"], ["Smith, J.", 'said "hi"\nthen left', "$1,200.50"]]);
  });

  it("drops blank rows and trailing blank columns", () => {
    expect(parseDelimited("a\tb\t\n\n\t\t\nc\td\t\n")).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("value cleanup", () => {
  it("parses money strings", () => {
    expect(parseMoney("$1,234.56")).toBe(1234.56);
    expect(parseMoney(" 45 ")).toBe(45);
    expect(parseMoney("(45.00)")).toBe(-45);
    expect(parseMoney("USD 12.5")).toBe(12.5);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("—")).toBeNull();
    expect(parseMoney("n/a")).toBeNull();
    expect(parseMoney(99)).toBe(99);
  });

  it("parses percentages, reading a bare fraction as a percent", () => {
    expect(parsePercent("24.99%")).toBe(24.99);
    expect(parsePercent("0.2499")).toBe(24.99);
    expect(parsePercent("6.9")).toBe(6.9);
    expect(parsePercent("0%")).toBe(0);
    expect(parsePercent("")).toBeNull();
  });

  it("parses the date formats spreadsheets produce", () => {
    expect(parseDate("2026-10-25")).toBe("2026-10-25");
    expect(parseDate("10/25/2026")).toBe("2026-10-25");
    expect(parseDate("10/25/26")).toBe("2026-10-25");
    expect(parseDate("Oct 25, 2026")).toBe("2026-10-25");
    expect(parseDate("25 October 2026")).toBe("2026-10-25");
    expect(parseDate("46320")).toBe("2026-10-25"); // spreadsheet serial
    expect(parseDate("2/30/2026")).toBeNull();
    expect(parseDate("someday")).toBeNull();
  });

  it("parses due days", () => {
    expect(parseDueDay("15")).toBe(15);
    expect(parseDueDay("the 1st")).toBe(1);
    expect(parseDueDay("22nd")).toBe(22);
    expect(parseDueDay("10/15/2026")).toBe(15);
    expect(parseDueDay("32")).toBeNull();
    expect(parseDueDay("")).toBeNull();
  });

  it("parses tiers by number or name, and forever loans", () => {
    expect(parseTier("1")).toEqual({ protected: false, priority: 1 });
    expect(parseTier("Tier 3")).toEqual({ protected: false, priority: 3 });
    expect(parseTier("Core Payoff")).toEqual({ protected: false, priority: 2 });
    expect(parseTier("Minimum only, forever")).toEqual({ protected: true, priority: null });
    expect(parseTier("whenever")).toBeNull();
  });

  it("matches free-text types to the app's options", () => {
    expect(matchOption("credit card", CATEGORY_OPTIONS)).toBe("Credit Card");
    expect(matchOption("Car", CATEGORY_OPTIONS)).toBe("Auto Loan");
    expect(matchOption("Visa", CATEGORY_OPTIONS)).toBe("Credit Card");
    expect(matchOption("something odd", CATEGORY_OPTIONS)).toBeNull();
  });
});

describe("columns", () => {
  it("finds the header row even under a title row", () => {
    const rows = [["My debts"], ["Name", "Balance", "Payment", "APR"], ["Amex", "3400", "120", "24.99%"]];
    expect(detectHeaderRow(rows)).toBe(1);
    expect(detectHeaderRow([["Amex", "3400", "120"], ["Chase", "2100", "95"]])).toBe(-1);
  });

  it("auto-maps common header names", () => {
    const headers = ["Account", "Current Balance", "Min Payment", "Interest Rate", "Due Date", "Type", "Priority"];
    expect(autoMapColumns(headers, "debts")).toEqual({ name: 0, balance: 1, monthly: 2, apr: 3, dueDay: 4, type: 5, tier: 6 });
    expect(autoMapColumns(["Date", "Merchant", "Category", "Amount"], "expenses")).toEqual({ date: 0, amount: 3, category: 2, note: 1 });
  });

  it("labels columns by header or letter", () => {
    expect(columnLabels([["Name", ""], ["a", "b"]], 0)).toEqual(["Name (A)", "Column B"]);
  });
});

describe("buildPreview", () => {
  const rows = [
    ["Name", "Balance", "Payment", "APR", "Due", "Tier"],
    ["Amex", "$3,500.00", "$125", "24.99%", "12th", "1"],
    ["New Card", "$500", "$25", "19.9%", "5", "2"],
    ["Mortgage", "", "", "", "", ""],
    ["chase sapphire", "$2,100", "$95", "21.49%", "20", "2"],
    ["Amex", "$1", "$1", "", "", ""],
  ];
  const existing = [
    { id: "a", name: "Amex", balance: 3400, monthly: 120, apr: 24.99, dueDay: 12, priority: 1 },
    { id: "c", name: "Chase Sapphire", balance: 2100, monthly: 95, apr: 21.49, dueDay: 20, priority: 2 },
  ];
  const mapping = autoMapColumns(rows[0], "debts");
  const preview = buildPreview({ rows, headerRow: 0, mapping, target: "debts", existing });

  it("updates an existing item matched by name, listing only what changes", () => {
    expect(preview[0].match).toMatchObject({ kind: "update", existingId: "a" });
    expect(preview[0].match.changes.map((c) => [c.key, c.from, c.to])).toEqual([["monthly", 120, 125], ["balance", 3400, 3500]]);
    expect(preview[0].selected).toBe(true);
  });

  it("adds anything that doesn't match", () => {
    expect(preview[1]).toMatchObject({ match: { kind: "new" }, selected: true, values: { name: "New Card", balance: 500, monthly: 25, apr: 19.9, dueDay: 5 } });
  });

  it("flags rows it can't use and leaves them unchecked", () => {
    expect(preview[2].problems).toEqual(["no balance or monthly payment"]);
    expect(preview[2].selected).toBe(false);
  });

  it("matches names regardless of case/spacing, and skips a match with nothing to change", () => {
    expect(preview[3].match).toMatchObject({ kind: "update", existingId: "c", changes: [] });
    expect(preview[3].selected).toBe(false);
  });

  it("doesn't let two rows update the same item", () => {
    expect(preview[4].match).toMatchObject({ kind: "repeat" });
    expect(preview[4].selected).toBe(false);
  });

  it("won't guess between two existing items with the same name", () => {
    const p = buildPreview({ rows: [["Name", "Payment"], ["Visa", "40"]], headerRow: 0, mapping: { name: 0, monthly: 1 }, target: "debts", existing: [{ id: "1", name: "Visa" }, { id: "2", name: "visa" }] });
    expect(p[0].match).toMatchObject({ kind: "ambiguous", count: 2 });
    expect(p[0].selected).toBe(false);
  });

  it("turns rows into new debts and patches", () => {
    expect(newDebtFrom(preview[1].values)).toMatchObject({ name: "New Card", type: "Other Loan", monthly: 25, balance: 500, priority: 2, protected: false });
    expect(patchFrom(preview[0].match.changes, preview[0].values)).toEqual({ monthly: 125, balance: 3500 });
  });

  it("handles expenses: dates, amounts, categories and likely duplicates", () => {
    const exp = [["Date", "Merchant", "Category", "Amount"], ["10/20/2026", "Costco", "groceries", "$64.12"], ["10/21/2026", "Shell", "Fuel", "$41.00"], ["soon", "?", "", "x"]];
    const p = buildPreview({ rows: exp, headerRow: 0, mapping: autoMapColumns(exp[0], "expenses"), target: "expenses" });
    expect(p[0].values).toEqual({ date: "2026-10-20", amount: 64.12, category: "Groceries", note: "Costco" });
    expect(p[1].values.category).toBe("Gas");
    expect(p[2].problems).toEqual(['can\'t read date "soon"', 'can\'t read amount "x"']);
    const marked = markDuplicateExpenses(p, [{ date: "2026-10-20", amount: 64.12, note: "costco" }]);
    expect(marked[0]).toMatchObject({ match: { kind: "duplicate" }, selected: false });
    expect(marked[1].selected).toBe(true);
  });
});
