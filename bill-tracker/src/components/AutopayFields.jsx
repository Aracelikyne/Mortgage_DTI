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
  return (
    <ListSection
      header="Autopay"
      footer={draft.autopay
        ? (biweekly
          ? "Repeats every 14 days from the first debit, so it keeps landing on the same weekday. The monthly amount still drives interest and payoff math — these two fields drive the paycheck plan and this month's status."
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
              <NumberField label="Amount per debit" value={draft.autopayAmount} placeholder={monthly ? String(Number(monthly) / 2) : ""} onChange={set("autopayAmount")} />
            </>
          )}
        </>
      )}
    </ListSection>
  );
}
