// Autopay fields in a bill's edit sheet are held as strings while editing;
// these convert between that draft and what's stored on the bill.

export function autopayDraft(item) {
  return {
    autopay: !!item?.autopay,
    autopayFrequency: item?.autopayFrequency || "monthly",
    autopayAnchor: item?.autopayAnchor || "",
    autopayAmount: item?.autopayAmount ?? "",
  };
}

export function autopayPatch(draft) {
  if (!draft.autopay) return { autopay: false, autopayFrequency: null, autopayAnchor: null, autopayAmount: null };
  const biweekly = draft.autopayFrequency === "biweekly";
  return {
    autopay: true,
    autopayFrequency: biweekly ? "biweekly" : "monthly",
    autopayAnchor: biweekly ? draft.autopayAnchor || null : null,
    autopayAmount: biweekly && draft.autopayAmount !== "" ? Number(draft.autopayAmount) : null,
  };
}

// Biweekly autopay can't be placed on the calendar without its first debit.
export function autopayIncomplete(draft) {
  return !!draft.autopay && draft.autopayFrequency === "biweekly" && !draft.autopayAnchor;
}
