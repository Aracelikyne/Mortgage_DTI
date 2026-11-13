import { useState } from "react";
import Sheet, { SheetAction } from "./ui/Sheet";
import { ListRow, ListSection } from "./ui/List";
import { markBillPaid } from "../utils/billStatus";
import { lastMonthUnpaid, pastDueNow } from "../utils/markPaidChecks";
import { isoDate, money } from "../utils/finance";
import { useHouseholdContext } from "../state/HouseholdContext";

// "Don't remind me again this session" — kept for the browser tab's session,
// and in memory too in case storage is blocked (private browsing).
const SKIP_KEY = "ctc-skip-past-due-reminder";
let skipInMemory = false;
function skippingReminder() {
  if (skipInMemory) return true;
  try { return sessionStorage.getItem(SKIP_KEY) === "1"; } catch { return false; }
}
function skipReminderForSession() {
  skipInMemory = true;
  try { sessionStorage.setItem(SKIP_KEY, "1"); } catch { /* memory flag covers it */ }
}

const monthName = (d) => d.toLocaleDateString("en-US", { month: "long" });
const shortDay = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

// Marking a bill paid, with two checks around it:
//  - last month's payment on the same bill was never marked: did you pay it
//    (logged on its due date), or come current now (logged today)?
//  - other bills are still past due: a reminder listing them, which can be
//    turned off for the rest of the session in one tap.
// Returns `markPaid(row, monthKey)` and the `dialogs` to render.
export function useMarkPaid() {
  const { monthlyBills, paidByMonth, setPaidByMonth } = useHouseholdContext();
  const [lastMonth, setLastMonth] = useState(null); // { row, monthKey, prevKey, prev, rows }
  const [reminder, setReminder] = useState(null); // past-due rows

  function commit(transform, markedRowId) {
    const next = transform(paidByMonth);
    setPaidByMonth(transform);
    if (!skippingReminder()) {
      const due = pastDueNow(monthlyBills, next, markedRowId);
      if (due.length > 0) setReminder(due);
    }
  }

  const markThisMonth = (pbm, row, monthKey) => markBillPaid(pbm, monthKey, row.bill, new Date(), row);
  // Last month's unpaid payments, logged on their own due dates ("I paid it") or today ("come current").
  const markLastMonth = (pbm, { prevKey, rows }, onDueDates) =>
    rows.reduce((next, s) => markBillPaid(next, prevKey, s.bill, onDueDates ? s.dueDate : new Date(), s), pbm);

  function markPaid(row, monthKey) {
    const behind = lastMonthUnpaid(row, monthKey, paidByMonth);
    if (behind) {
      setLastMonth({ row, monthKey, ...behind });
      return;
    }
    commit((pbm) => markThisMonth(pbm, row, monthKey), row.rowId);
  }

  function resolveLastMonth(choice) {
    const lm = lastMonth;
    setLastMonth(null);
    if (!lm) return;
    commit((pbm) => {
      const caughtUp = choice === "paid" ? markLastMonth(pbm, lm, true) : choice === "current" ? markLastMonth(pbm, lm, false) : pbm;
      return markThisMonth(caughtUp, lm.row, lm.monthKey);
    }, lm.row.rowId);
  }

  const owedLastMonth = lastMonth ? lastMonth.rows.reduce((s, r) => s + r.remaining, 0) : 0;
  const dialogs = (
    <>
      {lastMonth && (
        <Sheet title="Last month" onClose={() => setLastMonth(null)}>
          <ListSection
            header={`${lastMonth.row.bill.name} · ${monthName(lastMonth.prev)}`}
            footer={`${monthName(lastMonth.prev)}'s payment was never marked paid. "I paid it" logs it on its due date; "Come current" logs it today, along with this month's.`}
          >
            {lastMonth.rows.map((r) => (
              <ListRow key={r.rowId} title={r.displayName} subtitle={`Was due ${shortDay(r.dueDate)}`} detail={<span className="num">{money(r.remaining)}</span>} />
            ))}
          </ListSection>
          <ListSection>
            <SheetAction onClick={() => resolveLastMonth("paid")}>I paid it — mark {monthName(lastMonth.prev)} paid too</SheetAction>
            <SheetAction onClick={() => resolveLastMonth("current")}>Come current — pay {money(owedLastMonth)} for {monthName(lastMonth.prev)} now</SheetAction>
            <SheetAction onClick={() => resolveLastMonth("skip")}>Just mark this month</SheetAction>
          </ListSection>
        </Sheet>
      )}
      {!lastMonth && reminder && (
        <Sheet title="Still past due" onClose={() => setReminder(null)}>
          <ListSection
            header={`${reminder.length} bill${reminder.length === 1 ? "" : "s"} past due`}
            footer="Mark them paid on the Monthly Plan once they're paid."
          >
            {reminder.map((r) => (
              <ListRow key={`${isoDate(r.dueDate)}-${r.rowId}`} title={r.displayName} subtitle={r.note} detail={<span className="num tone-red">{money(r.remaining)}</span>} />
            ))}
          </ListSection>
          <ListSection>
            <SheetAction onClick={() => { skipReminderForSession(); setReminder(null); }}>Don't remind me again this session</SheetAction>
          </ListSection>
        </Sheet>
      )}
    </>
  );

  return { markPaid, dialogs };
}
