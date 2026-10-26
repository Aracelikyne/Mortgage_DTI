// What each Dashboard number means, in plain words, with the household's
// own numbers plugged in — so two cards that happen to show the same date
// still say what's different about them.

import { money, pct } from "./finance";

export const STRATEGY_NAME = { tiered: "your tier order", snowball: "snowball order (smallest balance first)", avalanche: "avalanche order (highest APR first)" };

export function dashboardMetrics(h) {
  const income = Number(h.income) || 0;
  const extra = Number(h.recurringExtra) || 0;
  const target = Number(h.targetDTI) || 0;
  const mortgage = Number(h.mortgageEstimate) || 0;
  const noPayoff = h.sim.noPayoffDebts || [];
  const noPayoffNote = noPayoff.length
    ? ` ${noPayoff.length} debt${noPayoff.length === 1 ? " has" : "s have"} no payoff entered yet (${noPayoff.join(", ")}) and ${noPayoff.length === 1 ? "isn't" : "aren't"} part of this date until ${noPayoff.length === 1 ? "it's" : "they're"} filled in.`
    : "";
  const plan = `Each month: every minimum payment, plus your ${money(extra)} recurring extra${h.boosts.length ? ` and ${h.boosts.length} one-time boost${h.boosts.length === 1 ? "" : "s"}` : ""}, aimed at debts in ${STRATEGY_NAME[h.strategy] || "your tier order"}. Interest is added monthly from each APR. When a debt is paid off, its payment rolls into the next one.`;
  const payoffActions = [
    { label: "Change recurring extra or strategy", page: "budget" },
    { label: "Add a one-time boost", page: "timeline" },
    { label: "Edit debts (payoffs, minimums, Goal)", page: "debts" },
  ];
  const rentNote = h.includeRent ? ` plus your ${money(h.rentMonthly)} rent (you turned that on)` : "";
  const dtiTone = h.dtiBand === "good" ? "green" : h.dtiBand === "over" ? "red" : "orange";

  return [
    {
      key: "balance",
      label: "Total debt balance",
      value: money(h.totalDebtBalance),
      tone: "red",
      caption: noPayoff.length ? `${noPayoff.length} debt${noPayoff.length === 1 ? "" : "s"} missing a payoff` : "What you owe today",
      details: [
        { title: "What it shows", text: "Every debt's payoff added up, as of today: each payoff as last updated, minus the payments logged since then (interest included)." },
        ...(noPayoff.length ? [{ title: "Not included", text: `No payoff entered yet: ${noPayoff.join(", ")}.` }] : []),
      ],
      actions: [{ label: "Update payoffs on Debts", page: "debts" }],
    },
    {
      key: "monthly",
      label: "Monthly debt payments",
      value: money(h.totalDebtMonthly),
      caption: "Minimums on every debt",
      details: [{ title: "What it shows", text: "The minimum monthly payment on every debt, added up. Fixed expenses like rent and utilities aren't included — they're not debts." }],
      actions: [{ label: "Edit minimums on Debts", page: "debts" }],
    },
    {
      key: "dti",
      label: "Current DTI",
      value: pct(h.dti),
      tone: dtiTone,
      caption: "Debt payments ÷ gross income",
      details: [
        { title: "What it shows", text: "Debt-to-income: the share of your gross (before-tax) monthly income that goes to debt payments. Lenders compare this to limits like 36% and 43%." },
        { title: "How it's calculated", text: `${money(h.totalDebtMonthly)} debt payments${rentNote} ÷ ${money(income)} gross income = ${pct(h.dti)}.` },
      ],
      actions: [{ label: "Change income on Income & Budget", page: "budget" }],
    },
    {
      key: "debtFree",
      label: "Target debt-free",
      value: h.debtFreeLabel,
      tone: h.sim.freedomMonth !== null ? "green" : "red",
      small: true,
      caption: "When your goal debts hit $0",
      details: [
        { title: "What it shows", text: `The month every debt counted toward your goal reaches $0. Minimum-only ("forever") loans and debts with Goal turned off are left out — see "Totally debt-free" for those.${noPayoffNote}` },
        { title: "How it's calculated", text: plan },
      ],
      blockers: h.sim.stuckGoalDebts || [],
      actions: payoffActions,
    },
    {
      key: "trueDti",
      label: `True DTI (with ${money(mortgage)} mortgage)`,
      value: pct(h.trueDti),
      tone: h.trueDti !== null && h.trueDti <= target ? "green" : "red",
      caption: "What a lender would see today",
      details: [
        { title: "What it shows", text: "Your DTI if you applied for the mortgage today: current debt payments plus the new mortgage payment. Rent isn't counted — the mortgage replaces it." },
        { title: "How it's calculated", text: `(${money(h.totalDebtMonthly)} debts + ${money(mortgage)} mortgage) ÷ ${money(income)} gross income = ${pct(h.trueDti)}.` },
      ],
      actions: [{ label: "Change the mortgage estimate", page: "budget" }],
    },
    {
      key: "underTarget",
      label: `Under ${target}% DTI by`,
      value: h.dtiTargetLabel,
      tone: "orange",
      small: true,
      caption: "Debts alone under your target",
      details: [
        { title: "What it shows", text: `The month your debt payments alone drop under ${target}% of gross income, as debts get paid off along the way. No mortgage included — see "Mortgage-ready by" for that.` },
        { title: "How it's calculated", text: `Same month-by-month payoff as the debt-free date. Each month it checks: remaining debts' minimums${rentNote} ÷ ${money(income)} ≤ ${target}%?` },
      ],
      actions: [{ label: "Change the target DTI or income", page: "budget" }, ...payoffActions.slice(0, 1)],
    },
    {
      key: "mortgageReady",
      label: `Mortgage-ready by (${target}% with mortgage)`,
      value: h.dtiWithMortgageTargetLabel,
      tone: "orange",
      small: true,
      caption: "Debts + mortgage under your target",
      details: [
        { title: "What it shows", text: `The month you could likely qualify for the ${money(mortgage)}/month mortgage at a ${target}% DTI: when your remaining debt payments plus that mortgage drop under ${target}% of gross income.` },
        { title: "How it's calculated", text: `Same payoff projection. Each month it checks: (remaining debts' minimums + ${money(mortgage)}) ÷ ${money(income)} ≤ ${target}%?` },
      ],
      actions: [{ label: "Change the mortgage estimate or target", page: "budget" }, ...payoffActions.slice(0, 1)],
    },
    ...(h.hasExcludedWithBalance ? [{
      key: "fullDebtFree",
      label: "Totally debt-free (incl. forever loans)",
      value: h.fullDebtFreeLabel,
      small: true,
      caption: "Every debt at $0, forever loans too",
      details: [
        { title: "What it shows", text: `Like "Target debt-free", but waits for every debt with a payoff to reach $0 — including minimum-only loans and debts with Goal turned off, which only ever get their minimum.${noPayoffNote}` },
        { title: "How it's calculated", text: plan },
      ],
      blockers: [...(h.sim.underwaterDebts || []).map((name) => ({ name, reason: "minimum-only, and its payment doesn't cover the interest" }))],
      actions: payoffActions,
    }] : []),
    ...(h.availableAfterBills !== null ? [{
      key: "available",
      label: "Available toward debt each month",
      value: money(h.availableAfterBills),
      tone: h.availableAfterBills < 0 ? "red" : "green",
      caption: h.availableAfterBills < 0 ? "Bills cost more than take-home" : "Left after every bill",
      details: [
        { title: "What it shows", text: "What's left of your take-home pay each month after every debt minimum and fixed expense. A negative number means the bills add up to more than you bring home." },
        { title: "How it's calculated", text: `${money(h.netIncomeNum)} take-home − ${money(h.totalDebtMonthly)} debt payments − ${money(h.totalFixedMonthly)} fixed expenses = ${money(h.availableAfterBills)}.` },
      ],
      actions: [{ label: "Change take-home pay", page: "budget" }, { label: "Edit fixed expenses", page: "fixed" }],
    }] : []),
  ];
}
