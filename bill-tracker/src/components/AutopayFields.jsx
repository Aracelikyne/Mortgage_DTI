import { ListRow, ListSection, NumberField, SwitchRow } from "./ui/List";
import { monthlyFromDraft, twiceMonthlyDefaults } from "../utils/autopay";
import { ordinal } from "../utils/format";

const cents = (n) => Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

// The payment fields of a bill's edit sheet: the monthly payment and due
// day, or — with "Twice a month" on — the amount of each payment and both
// due days, with the monthly payment worked out from them so the two can't
// disagree. `monthlyLabel` is "Monthly payment" for a debt, "Monthly amount"
// for a fixed expense.
//
// `draft` holds string inputs: monthly, dueDay, twiceMonthly, dueDay2, paymentAmount.
export function PaymentScheduleFields({ draft, set, setDraft, monthlyLabel = "Monthly payment" }) {
  const twice = !!draft.twiceMonthly;
  const per = Number(draft.paymentAmount) || 0;
  return (
    <>
      <SwitchRow
        label="Twice a month"
        subtitle={twice ? "Two payments a month, one balance" : undefined}
        checked={twice}
        onChange={(on) => setDraft((d) => ({ ...d, twiceMonthly: on, ...(on ? twiceMonthlyDefaults(d) : {}) }))}
      />
      {twice ? (
        <>
          <NumberField label="Amount per payment" value={draft.paymentAmount} onChange={set("paymentAmount")} placeholder="required" />
          <NumberField label="Payment 1 due day" value={draft.dueDay} onChange={set("dueDay")} placeholder="required" min="1" max="31" step="1" />
          <NumberField label="Payment 2 due day" value={draft.dueDay2} onChange={set("dueDay2")} placeholder="required" min="1" max="31" step="1" />
          <ListRow
            title={monthlyLabel}
            subtitle={per > 0 ? `2 × ${cents(per)}${draft.dueDay && draft.dueDay2 ? `, due the ${ordinal(Number(draft.dueDay))} and ${ordinal(Number(draft.dueDay2))}` : ""}` : undefined}
            detail={<span className="num">{cents(monthlyFromDraft(draft))}</span>}
          />
        </>
      ) : (
        <>
          <NumberField label={monthlyLabel} value={draft.monthly} onChange={set("monthly")} placeholder="required" />
          <NumberField label="Due day of month" value={draft.dueDay} onChange={set("dueDay")} placeholder="optional" min="1" max="31" step="1" />
        </>
      )}
    </>
  );
}

// Autopay on or off. It pays each payment on its due date — both of a
// twice-a-month bill's — so the app stops waiting on a manual payment.
export default function AutopayFields({ draft, set }) {
  return (
    <ListSection
      header="Autopay"
      footer={draft.autopay
        ? `Pays itself on ${draft.twiceMonthly ? "both due days" : "the due day"} each month. Each payment counts as paid once its day passes, and never shows as past due.`
        : "Turn on if this bill pays itself automatically, so the app doesn't wait on a manual payment."}
    >
      <SwitchRow label="Autopay" checked={!!draft.autopay} onChange={(on) => set("autopay")(on)} />
    </ListSection>
  );
}
