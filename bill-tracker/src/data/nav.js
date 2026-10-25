import { Activity, Calendar, LayoutDashboard, ListChecks, PiggyBank, Receipt, ShoppingCart, TrendingDown, Wallet } from "lucide-react";

// Every section of the app. `tab` is the short label used under the icon in
// the phone tab bar, where there's room for about ten characters.
export const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", tab: "Dashboard", icon: LayoutDashboard },
  { key: "monthly", label: "Monthly Plan", tab: "Monthly", icon: ListChecks },
  { key: "paycheck", label: "Paycheck Plan", tab: "Paychecks", icon: Calendar },
  { key: "debts", label: "Debts", tab: "Debts", icon: PiggyBank },
  { key: "budget", label: "Income & Budget", tab: "Budget", icon: Wallet },
  { key: "timeline", label: "Payoff Timeline", tab: "Payoff", icon: TrendingDown },
  { key: "fixed", label: "Fixed Expenses", tab: "Fixed", icon: Receipt },
  { key: "expenses", label: "Expenses", tab: "Expenses", icon: ShoppingCart },
  { key: "activity", label: "Activity", tab: "Activity", icon: Activity },
];

// iOS tab bars top out at five items: the first four sections in the
// (per-device, reorderable) order get their own tab; the rest live in More.
export const TAB_BAR_SLOTS = 4;

export const NAV_LABELS = Object.fromEntries(NAV_ITEMS.map((n) => [n.key, n.label]));

// Icon tile colors for the sections, Settings-app style.
export const SECTION_COLORS = {
  dashboard: "var(--blue)",
  monthly: "var(--green)",
  paycheck: "var(--teal)",
  debts: "var(--red)",
  budget: "var(--indigo)",
  timeline: "var(--purple)",
  fixed: "var(--orange)",
  expenses: "var(--pink)",
  activity: "var(--gray)",
};
