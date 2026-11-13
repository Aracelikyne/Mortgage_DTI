// A bill's payment schedule and autopay setting, as edited in its sheet.
// Fields are held as strings while editing; these convert between that
// draft and what's stored on the bill.
//
// A bill is paid once a month on its due day, or — switched to "twice a
// month" — in two payments with their own due days, both coming off the same
// balance (MK Upstart: $250 on the 1st and $250 on the 15th). Autopay is just
// on or off: it pays each payment on its due date.

import { isTwiceMonthly, paymentDaysOf, perPaymentOf } from "./finance";

const asInput = (v) => (v === null || v === undefined || Number.isNaN(v) ? "" : String(v));

export function autopayDraft(item) {
  // A bill saved as autopay "every 2 weeks" opens as twice a month, filled in
  // from its old schedule, so saving it once moves it over.
  const twice = isTwiceMonthly(item);
  const [day1, day2] = twice ? paymentDaysOf(item) : [];
  return {
    autopay: !!item?.autopay,
    twiceMonthly: twice,
    ...(twice ? { dueDay: asInput(day1) } : {}),
    dueDay2: asInput(twice ? day2 : item?.dueDay2),
    paymentAmount: twice ? asInput(Math.round(perPaymentOf(item) * 100) / 100) : asInput(item?.paymentAmount),
  };
}

export function autopayPatch(draft) {
  const twice = !!draft.twiceMonthly;
  return {
    autopay: !!draft.autopay,
    twiceMonthly: twice,
    dueDay2: twice && draft.dueDay2 !== "" ? Number(draft.dueDay2) : null,
    paymentAmount: twice && draft.paymentAmount !== "" ? Number(draft.paymentAmount) : null,
    // The old "every 2 weeks" fields, cleared now that the schedule above replaces them.
    autopayFrequency: null,
    autopayAnchor: null,
    autopayAmount: null,
  };
}

// A twice-a-month bill needs both due days and its payment amount.
export function autopayIncomplete(draft) {
  if (!draft.twiceMonthly) return false;
  const day = (v) => Number(v) >= 1 && Number(v) <= 31;
  return !day(draft.dueDay) || !day(draft.dueDay2) || !(Number(draft.paymentAmount) > 0);
}

// The monthly payment to save. A twice-a-month bill's is its two payments,
// so the two can never disagree; any other bill's is what was typed.
export function monthlyFromDraft(draft) {
  if (draft.twiceMonthly) return Math.round((Number(draft.paymentAmount) || 0) * 2 * 100) / 100;
  return draft.monthly === "" || draft.monthly === null || draft.monthly === undefined ? 0 : Number(draft.monthly);
}

// Turning "twice a month" on: start from half the monthly payment, with the
// second payment two weeks after the first.
export function twiceMonthlyDefaults(draft) {
  const day1 = Number(draft.dueDay) >= 1 ? Number(draft.dueDay) : 1;
  return {
    dueDay: String(day1),
    dueDay2: draft.dueDay2 !== "" ? draft.dueDay2 : String(day1 + 14 > 28 ? day1 + 14 - 28 : day1 + 14),
    paymentAmount: draft.paymentAmount !== "" ? draft.paymentAmount : Number(draft.monthly) > 0 ? String(Math.round((Number(draft.monthly) / 2) * 100) / 100) : "",
  };
}
