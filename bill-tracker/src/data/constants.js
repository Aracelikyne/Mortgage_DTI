// src/data/constants.js

// Colors are CSS variables (iOS system colors, see styles/app.css) so they
// adapt to dark mode.
export const TIERS = {
  1: { label: "Quick Wins", color: "var(--tier-1)" },
  2: { label: "Core Payoff", color: "var(--tier-2)" },
  3: { label: "Large Loans", color: "var(--tier-3)" },
  4: { label: "Deprioritized", color: "var(--tier-4)" },
};

// The category dropdown on each debt row: the four payoff tiers, plus the
// escape hatch for a debt that isn't part of the payoff plan at all.
export const PRIORITY_OPTIONS = [
  { value: "1", label: `1 · ${TIERS[1].label}` },
  { value: "2", label: `2 · ${TIERS[2].label}` },
  { value: "3", label: `3 · ${TIERS[3].label}` },
  { value: "4", label: `4 · ${TIERS[4].label}` },
  { value: "protected", label: "Forever loan (minimum only)" },
];

export const CATEGORY_OPTIONS = [
  "Credit Card", "Personal Loan", "Auto Loan", "Student Loan",
  "Bootcamp Loan", "Retail Card", "Other Loan",
];

export const FIXED_CATEGORY_OPTIONS = [
  "Rent/Mortgage", "Utility", "Childcare", "Insurance", "Subscription", "Other"
];

// Categories for manually-logged, day-to-day spending on the Expenses tab —
// distinct from CATEGORY_OPTIONS/FIXED_CATEGORY_OPTIONS above, which are
// for recurring debts/bills, not one-off purchases.
export const EXPENSE_CATEGORIES = [
  "Groceries", "Gas", "Fast Food", "Dining Out", "Shopping",
  "Entertainment", "Health", "Household", "Subscriptions", "Travel", "Other",
];

// New ids come from newId() in src/utils/ids.js — never a counter, which
// restarts on every page load and hands out ids that are already taken.

// No personal financial data belongs here — this file is public source code.
// Real debts/expenses are entered in the app and saved per-account in Supabase.
export const initialDebts = [];

export const initialFixed = [];