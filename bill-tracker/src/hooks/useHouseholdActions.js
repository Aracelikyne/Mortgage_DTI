import { newId } from "../utils/ids";
import { addExtraPayments, addPaymentRecord, isoDate, monthKeyOf, removeExtraBatch, removePaymentRecord } from "../utils/finance";

// Every edit the pages can make to the household data, in one place.
export function useHouseholdActions(h, model) {
  const { debts, paidOffDebts, setDebts, setPaidOffDebts, setFixed, setIncomeSources, setBoosts, setPaycheckOverrides, setPaidByMonth } = h;

  function updateDebt(id, patch) {
    setDebts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }
  // Which payoff category a debt belongs to, and how to move it to another
  // one — a single control that replaces having to know that "protected"
  // and "priority" are two separate fields under the hood.
  function categoryPatch(value) {
    return value === "protected"
      ? { protected: true, priority: null, excludeFromGoal: true }
      : { protected: false, priority: Number(value), excludeFromGoal: false };
  }
  function addDebt(newDebt) {
    const debt = { id: newId(), excludeFromGoal: false, protected: false, apr: null, dueDay: null, graceDays: 0, ...newDebt };
    setDebts((prev) => [...prev, debt]);
    return debt;
  }
  // Deleting a debt never erases it outright — it moves to the Paid Off
  // archive, preserving what it was worth so "paid off so far" keeps a real
  // running total instead of the debt just vanishing. Restore undoes the
  // archive if it was deleted by mistake.
  function removeDebt(id) {
    const d = debts.find((x) => x.id === id);
    if (d) {
      const balanceAtPayoff = model.runningBalanceOf(d);
      const archived = { ...d, balanceAtPayoff, payoffDate: isoDate(new Date()) };
      setPaidOffDebts((prev) => [...prev, archived]);
    }
    setDebts((prev) => prev.filter((x) => x.id !== id));
  }
  function restoreDebt(id) {
    const d = paidOffDebts.find((x) => x.id === id);
    if (!d) return;
    const restored = { ...d };
    delete restored.balanceAtPayoff;
    delete restored.payoffDate;
    setDebts((prev) => [...prev, restored]);
    setPaidOffDebts((prev) => prev.filter((x) => x.id !== id));
  }
  function deleteArchivedDebt(id) {
    setPaidOffDebts((prev) => prev.filter((x) => x.id !== id));
  }

  function updateFixed(id, patch) {
    setFixed((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }
  function removeFixed(id) {
    setFixed((prev) => prev.filter((f) => f.id !== id));
  }
  function addFixed(newFixed) {
    const item = { id: newId(), note: "", dueDay: null, graceDays: 0, ...newFixed };
    setFixed((prev) => [...prev, item]);
    return item;
  }

  function updateIncomeSource(id, patch) {
    setIncomeSources((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function removeIncomeSource(id) {
    setIncomeSources((prev) => prev.filter((s) => s.id !== id));
  }
  function addIncomeSource(fields = {}) {
    const source = { id: newId(), name: "New paycheck", amount: "", nextPayDate: "", frequency: "biweekly", ...fields };
    setIncomeSources((prev) => [...prev, source]);
    return source;
  }

  function addBoost() {
    const boost = { id: newId(), month: 3, amount: 1000 };
    setBoosts((prev) => [...prev, boost]);
  }
  function updateBoost(id, patch) {
    setBoosts((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }
  function removeBoost(id) {
    setBoosts((prev) => prev.filter((b) => b.id !== id));
  }

  function overridePaycheckDate(sourceId, originalDate, newIsoDate) {
    const key = isoDate(originalDate);
    setPaycheckOverrides((prev) => {
      const forSource = { ...(prev[sourceId] || {}) };
      if (newIsoDate) forSource[key] = newIsoDate;
      else delete forSource[key];
      return { ...prev, [sourceId]: forSource };
    });
  }

  // A paycheck card can show one bill as two separate split items (part 1,
  // part 2) on two different checks — clicking one must only mark that
  // specific portion paid, not the whole bill, so the other split part
  // isn't wrongly crossed off too. Each paid item carries the exact
  // payment it came from, so toggling it off removes only that payment.
  function togglePaidFromPaycheckItem(item) {
    if (item.autopay) return; // autopay settles itself — nothing to toggle manually
    const mKey = item.monthKey || monthKeyOf(item.dueDate);
    if (item.paid && item.paymentId) {
      setPaidByMonth((prev) => removePaymentRecord(prev, mKey, item.billId, item.paymentId));
    } else if (!item.paid) {
      setPaidByMonth((prev) => addPaymentRecord(prev, mKey, item.billId, { amount: item.amount, date: isoDate(new Date()) }));
    }
  }

  // "Apply this" on the Extra money card logs real payments — one extra
  // payment per bill, dated today, tagged as one batch — instead of
  // rewriting each debt's stored balance. That way the money shows up on
  // the Monthly Plan, the Paycheck Plan and Expenses like any other
  // payment, moves the running balance the same way (interest included),
  // never counts toward a bill's regular minimum, and can be undone in one go.
  function applyExtraPayments(rows) {
    if (!rows || rows.length === 0) return;
    const now = new Date();
    const batch = { batchId: newId(), date: isoDate(now), appliedAt: now.toISOString() };
    const allocations = rows.map((r) => ({ billId: r.id, amount: r.applied }));
    setPaidByMonth((prev) => addExtraPayments(prev, monthKeyOf(now), allocations, batch));
  }
  function undoExtraBatch(batchId) {
    setPaidByMonth((prev) => removeExtraBatch(prev, batchId));
  }

  return {
    updateDebt, categoryPatch, addDebt, removeDebt, restoreDebt, deleteArchivedDebt,
    updateFixed, removeFixed, addFixed,
    updateIncomeSource, removeIncomeSource, addIncomeSource,
    addBoost, updateBoost, removeBoost,
    overridePaycheckDate, togglePaidFromPaycheckItem, applyExtraPayments, undoExtraBatch,
  };
}
