// Turns "the whole state blob changed" into a short list of human-readable
// edits, so the activity log can say what actually happened instead of just
// "something changed." Runs once per debounced save (not per keystroke),
// comparing the last-saved state to the state about to be saved.

function money(n) {
  const num = Number(n);
  return isNaN(num) ? String(n) : `$${Math.round(num).toLocaleString()}`;
}

function nameLookup(prevArr, nextArr) {
  const map = new Map();
  for (const item of [...(prevArr || []), ...(nextArr || [])]) {
    if (item?.id != null) map.set(item.id, item.name);
  }
  return map;
}

function diffCollection(prevArr, nextArr, label, changes) {
  const prevById = new Map((prevArr || []).map((x) => [x.id, x]));
  const nextById = new Map((nextArr || []).map((x) => [x.id, x]));
  for (const [id, item] of nextById) {
    if (!prevById.has(id)) changes.push(`Added ${label} "${item.name}"`);
  }
  for (const [id, item] of prevById) {
    if (!nextById.has(id)) changes.push(`Removed ${label} "${item.name}"`);
  }
  for (const [id, nextItem] of nextById) {
    const prevItem = prevById.get(id);
    if (prevItem && JSON.stringify(prevItem) !== JSON.stringify(nextItem)) {
      changes.push(`Updated ${label} "${nextItem.name}"`);
    }
  }
}

function normalizePayments(raw) {
  if (raw && typeof raw === "object" && Array.isArray(raw.payments)) return raw.payments;
  return [];
}

function diffPaidByMonth(prev, next, billNames, changes) {
  const months = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  for (const mKey of months) {
    const prevMonth = (prev || {})[mKey] || {};
    const nextMonth = (next || {})[mKey] || {};
    const billIds = new Set([...Object.keys(prevMonth), ...Object.keys(nextMonth)]);
    for (const billId of billIds) {
      const prevPayments = normalizePayments(prevMonth[billId]);
      const nextPayments = normalizePayments(nextMonth[billId]);
      if (JSON.stringify(prevPayments) === JSON.stringify(nextPayments)) continue;
      const name = billNames.get(billId) || billId;
      if (nextPayments.length > prevPayments.length) {
        const added = nextPayments[nextPayments.length - 1];
        changes.push(`Logged a ${money(added.amount)} payment on "${name}"`);
      } else if (nextPayments.length < prevPayments.length) {
        changes.push(`Removed a payment on "${name}"`);
      } else {
        changes.push(`Updated a payment on "${name}"`);
      }
    }
  }
}

function diffScalar(prev, next, key, label, changes, fmt = (v) => v) {
  const before = prev?.[key];
  const after = next?.[key];
  if (before === after) return;
  if ((before === undefined || before === null) && (after === undefined || after === null)) return;
  changes.push(`Changed ${label} to ${fmt(after)}`);
}

// `prev` is the last state actually saved to the shared row, `next` is the
// state about to be saved. Returns [] on the very first save (nothing to
// compare against yet) and caps the list so a bulk import or reset doesn't
// flood the log with dozens of rows in one go.
export function describeChanges(prev, next) {
  if (!prev) return [];
  const changes = [];
  const billNames = new Map([
    ...nameLookup(prev.debts, next.debts),
    ...nameLookup(prev.fixed, next.fixed),
  ]);

  diffCollection(prev.debts, next.debts, "debt", changes);
  diffCollection(prev.fixed, next.fixed, "expense", changes);
  diffCollection(prev.incomeSources, next.incomeSources, "paycheck source", changes);
  diffPaidByMonth(prev.paidByMonth, next.paidByMonth, billNames, changes);
  diffScalar(prev, next, "recurringExtra", "recurring extra payment", changes, money);
  diffScalar(prev, next, "targetDTI", "target DTI", changes, (v) => `${v}%`);
  diffScalar(prev, next, "mortgageEstimate", "mortgage estimate", changes, money);
  diffScalar(prev, next, "netIncome", "net income", changes, money);
  diffScalar(prev, next, "paycheckReserve", "paycheck reserve", changes, money);
  diffScalar(prev, next, "strategy", "payoff strategy", changes, (v) => v);
  diffScalar(prev, next, "includeRent", "include rent in DTI", changes, (v) => (v ? "on" : "off"));

  return changes.slice(0, 20);
}
