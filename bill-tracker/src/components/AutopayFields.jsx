import SegmentedControl from "./ui/SegmentedControl";
import { ListSection, NumberField, SwitchRow, TextField } from "./ui/List";

const FREQUENCIES = [
  { value: "monthly", label: "Monthly" },
  { value: "biweekly", label: "Every 2 weeks" },
];

// Autopay settings inside a bill's edit sheet, so the app stops expecting a
// manual payment each cycle and instead treats the money as committed the
// moment it's due. Monthly autopay reuses the bill's own due day; biweekly
// needs its own first-debit date and per-debit amount, since it lands twice
// a month on a shifting date rather than once on a fixed day.
//
// `draft` holds string inputs: autopay, autopayFrequency, autopayAnchor, autopayAmount.
export default function AutopayFields({ draft, set, monthly }) {
  const biweekly = draft.autopayFrequency === "biweekly";
  // A biweekly debit that isn't half the monthly payment takes out more (or
  // less) than "monthly" says — MK Upstart's $250 every 2 weeks is ≈$541.67
  // a month against $450. Say so where both numbers are typed.
  const perDebit = draft.autopayAmount !== "" && draft.autopayAmount !== null ? Number(draft.autopayAmount) : Number(monthly || 0) / 2;
  const actualMonthly = (perDebit * 26) / 12;
  const gap = actualMonthly - Number(monthly || 0);
  const cents = (n) => Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return (
    <ListSection
      header="Autopay"
      footer={draft.autopay
        ? (biweekly
          ? "Repeats every 14 days from the first debit, so it keeps landing on the same weekday, and the due day above is ignored. These debits — 26 a year — are what the balance, payoff, budget, paycheck plan and reminders use. The monthly amount above only counts toward DTI."
          : "Debits on this bill's due day each month. It counts as paid once that day passes, and never shows as past due.")
        : "Turn on if this bill debits itself automatically, so the app doesn't wait on a manual payment."}
    >
      <SwitchRow label="Autopay" checked={!!draft.autopay} onChange={(on) => set("autopay")(on)} />
      {draft.autopay && (
        <>
          <div className="row segmented-row">
            <SegmentedControl options={FREQUENCIES} value={draft.autopayFrequency || "monthly"} onChange={set("autopayFrequency")} label="Autopay frequency" />
          </div>
          {biweekly && (
            <>
              <TextField label="First debit date" type="date" value={draft.autopayAnchor} onChange={set("autopayAnchor")} />
              <NumberField
                label="Amount per debit"
                value={draft.autopayAmount}
                placeholder={monthly ? String(Number(monthly) / 2) : ""}
                onChange={set("autopayAmount")}
                hint={perDebit > 0 ? `≈${cents(actualMonthly)} a month actually debited${Number(monthly) > 0 && Math.abs(gap) >= 0.5 ? ` — ${cents(gap)} ${gap > 0 ? "more" : "less"} than the ${cents(Number(monthly))} monthly amount` : ""}.` : undefined}
              />
            </>
          )}
        </>
      )}
    </ListSection>
  );
}
