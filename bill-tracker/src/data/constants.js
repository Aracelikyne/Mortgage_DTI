// src/data/constants.js

export const TIERS = {
  1: { label: "Quick Wins", color: "#B8863F" },
  2: { label: "Core Payoff", color: "#8C6A9C" },
  3: { label: "Large Loans", color: "#A5473A" },
  4: { label: "Deprioritized", color: "#8A8272" },
};

export const CATEGORY_OPTIONS = [
  "Credit Card", "Personal Loan", "Auto Loan", "Student Loan",
  "Bootcamp Loan", "Retail Card", "Other Loan",
];

export const FIXED_CATEGORY_OPTIONS = [
  "Rent/Mortgage", "Utility", "Childcare", "Insurance", "Subscription", "Other"
];

let _id = 1000;
export const nextId = () => `b${_id++}`;

// No personal financial data belongs here — this file is public source code.
// Real debts/expenses are entered in the app and saved per-account in Supabase.
export const initialDebts = [];

export const initialFixed = [];