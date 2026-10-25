import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FileUp, Image as ImageIcon, Plus } from "lucide-react";
import PageHeader from "../components/PageHeader";
import ExpenseEditorSheet from "../components/ExpenseEditorSheet";
import Sheet from "../components/ui/Sheet";
import SegmentedControl from "../components/ui/SegmentedControl";
import { ListRow, ListSection, SelectField } from "../components/ui/List";
import { supabase } from "../lib/supabaseClient";
import { derivedBillExpenses, fmtDate, money, monthKeyOf } from "../utils/finance";
import { useHouseholdContext } from "../state/HouseholdContext";

// A category's color has to mean the same thing every time it appears, no
// matter what's filtered in or out — so this is a fixed lookup by name, not
// an index into whatever's currently visible. Every bill payment folds into
// one "Bills" identity: bill-level detail already lives on the Debts/Fixed
// tabs, and this tab exists to show discretionary spending.
const CATEGORY_COLORS = {
  Bills: "var(--blue)",
  Groceries: "var(--green)",
  Gas: "var(--orange)",
  "Fast Food": "var(--red)",
  "Dining Out": "var(--pink)",
  Shopping: "var(--purple)",
  Entertainment: "var(--indigo)",
  Health: "var(--teal)",
  Household: "var(--brown)",
  Subscriptions: "var(--cyan)",
  Travel: "var(--mint)",
};
const colorForCategory = (category) => CATEGORY_COLORS[category] || "var(--gray)";

// The category used for the breakdown chart — every bill payment is one
// "Bills" slice there; the transaction list still shows the real bill.
function chartCategoryOf(e) {
  return e.source === "bill" ? "Bills" : (e.category || "Other");
}

const RANGE_OPTIONS = [
  { value: "month", label: "Month" },
  { value: "3months", label: "3 Mo" },
  { value: "6months", label: "6 Mo" },
  { value: "year", label: "Year" },
  { value: "all", label: "All" },
];

function startDateFor(range) {
  const now = new Date();
  if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (range === "3months") return new Date(now.getFullYear(), now.getMonth() - 2, 1);
  if (range === "6months") return new Date(now.getFullYear(), now.getMonth() - 5, 1);
  if (range === "year") return new Date(now.getFullYear(), 0, 1);
  return null; // all time
}

function normalizeManualRow(row) {
  return {
    id: `manual:${row.id}`,
    rawId: row.id,
    amount: Number(row.amount) || 0,
    date: row.date,
    category: row.category,
    note: row.note,
    source: "manual",
    receiptPath: row.receipt_path,
    userName: row.user_name,
  };
}

const AXIS_TICK = { fontSize: 11, fill: "var(--label-2)", fontFamily: "var(--font)" };

export default function ExpensesPage() {
  const h = useHouseholdContext();
  const { debtBills, fixed, paidByMonth, userId, userName, sandboxActive } = h;
  const [rows, setRows] = useState(null); // null = loading
  const [loadError, setLoadError] = useState(null);
  const [range, setRange] = useState("month");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editing, setEditing] = useState(null); // an expense, or "new"
  const [viewingReceipt, setViewingReceipt] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("expenses")
      .select("id, user_id, user_name, amount, category, note, date, receipt_path, created_at")
      .order("date", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error(error);
          setLoadError("Couldn't load expenses — the expenses table may be missing (see supabase/expenses_migration.sql).");
          setRows([]);
          return;
        }
        setRows(data || []);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("expenses_changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "expenses" }, (payload) => {
        setRows((prev) => (prev && prev.some((r) => r.id === payload.new.id) ? prev : [payload.new, ...(prev || [])]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "expenses" }, (payload) => {
        setRows((prev) => (prev || []).map((r) => (r.id === payload.new.id ? payload.new : r)));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "expenses" }, (payload) => {
        setRows((prev) => (prev || []).filter((r) => r.id !== payload.old.id));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const billExpenses = useMemo(() => derivedBillExpenses(debtBills, fixed, paidByMonth), [debtBills, fixed, paidByMonth]);
  const manualExpenses = useMemo(() => (rows || []).map(normalizeManualRow), [rows]);
  const allExpenses = useMemo(
    () => [...billExpenses, ...manualExpenses].sort((a, b) => new Date(b.date) - new Date(a.date)),
    [billExpenses, manualExpenses]
  );

  const startDate = useMemo(() => startDateFor(range), [range]);
  const rangeFiltered = useMemo(() => {
    if (!startDate) return allExpenses;
    return allExpenses.filter((e) => e.date && new Date(e.date + "T00:00:00") >= startDate);
  }, [allExpenses, startDate]);
  const availableCategories = useMemo(() => [...new Set(rangeFiltered.map((e) => e.category || "Other"))].sort(), [rangeFiltered]);
  const filtered = useMemo(
    () => (categoryFilter === "all" ? rangeFiltered : rangeFiltered.filter((e) => (e.category || "Other") === categoryFilter)),
    [rangeFiltered, categoryFilter]
  );

  const total = filtered.reduce((s, e) => s + e.amount, 0);
  const txCount = filtered.length;
  const avgTx = txCount > 0 ? total / txCount : 0;

  const categoryTotals = useMemo(() => {
    const byCategory = new Map();
    for (const e of rangeFiltered) {
      const cat = chartCategoryOf(e);
      byCategory.set(cat, (byCategory.get(cat) || 0) + e.amount);
    }
    return [...byCategory.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  }, [rangeFiltered]);
  const rangeTotal = categoryTotals.reduce((s, c) => s + c.amount, 0);
  const topCategory = categoryTotals[0]?.category || "—";

  const monthlyTrend = useMemo(() => {
    const byMonth = new Map();
    // Trend always looks back over the last 6 months regardless of the
    // range control above — a one-month bar chart isn't a trend.
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 5);
    cutoff.setDate(1);
    for (const e of allExpenses) {
      if (!e.date) continue;
      const d = new Date(e.date + "T00:00:00");
      if (d < cutoff) continue;
      const key = monthKeyOf(d);
      byMonth.set(key, (byMonth.get(key) || 0) + e.amount);
    }
    const out = [];
    const cursor = new Date(cutoff);
    for (let i = 0; i < 6; i++) {
      const key = monthKeyOf(cursor);
      out.push({ key, label: cursor.toLocaleDateString("en-US", { month: "short" }), amount: byMonth.get(key) || 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return out;
  }, [allExpenses]);

  // Expenses are written straight to their own shared table rather than the
  // household row, so Sandbox's "nothing saves" can't cover them — block
  // the writes instead of letting them slip through as real data.
  function guardSandbox() {
    if (!sandboxActive) return false;
    setNotice("Expenses save straight to the shared list, so they can't be logged in Sandbox — exit Sandbox first.");
    return true;
  }

  async function openReceipt(path) {
    const { data, error } = await supabase.storage.from("receipts").createSignedUrl(path, 3600);
    if (error) { console.error(error); return; }
    setViewingReceipt(data.signedUrl);
  }

  async function saveExpense(form, receiptFile) {
    const existing = editing && editing !== "new" ? editing : null;
    let receiptPath = existing?.receiptPath || null;
    if (receiptFile) {
      const ext = receiptFile.name.split(".").pop() || "jpg";
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("receipts").upload(path, receiptFile);
      if (uploadError) throw uploadError;
      receiptPath = path;
    }
    const payload = { amount: Number(form.amount), category: form.category, note: form.note || null, date: form.date, receipt_path: receiptPath };
    if (existing) {
      const { error } = await supabase.from("expenses").update(payload).eq("id", existing.rawId);
      if (error) throw error;
      setRows((prev) => (prev || []).map((r) => (r.id === existing.rawId ? { ...r, ...payload } : r)));
    } else {
      const { data, error } = await supabase.from("expenses").insert({ ...payload, user_id: userId, user_name: userName }).select().single();
      if (error) throw error;
      setRows((prev) => (prev && prev.some((r) => r.id === data.id) ? prev : [data, ...(prev || [])]));
    }
  }

  async function deleteExpense(expense) {
    setRows((prev) => (prev || []).filter((r) => r.id !== expense.rawId));
    const { error } = await supabase.from("expenses").delete().eq("id", expense.rawId);
    if (error) console.error(error);
    if (expense.receiptPath) await supabase.storage.from("receipts").remove([expense.receiptPath]);
  }

  const editingExpense = editing && editing !== "new" ? editing : null;
  return (
    <>
      <PageHeader
        title="Expenses"
        actions={(
          <>
            <button type="button" className="nav-btn" onClick={() => h.openImport("expenses")} aria-label="Import from Numbers" title="Import from Numbers"><FileUp size={22} /></button>
            <button type="button" className="nav-btn" aria-label="Log expense" title="Log expense" onClick={() => { if (!guardSandbox()) setEditing("new"); }}>
              <Plus size={24} />
            </button>
          </>
        )}
      />
      <div className="page-content">
        {loadError && <p className="inline-warning">{loadError}</p>}
        {notice && <p className="inline-warning" role="status">{notice}</p>}

        <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} label="Time range" className="range-control" />

        <div className="widget-grid">
          <div className="widget"><div className="widget-label">Total spent</div><div className="widget-value num tone-red">{money(total)}</div></div>
          <div className="widget"><div className="widget-label">Transactions</div><div className="widget-value num">{txCount}</div></div>
          <div className="widget"><div className="widget-label">Average each</div><div className="widget-value num">{money(avgTx)}</div></div>
          <div className="widget"><div className="widget-label">Top category</div><div className="widget-value small">{topCategory}</div></div>
        </div>

        <section className="card">
          <h2 className="card-title">Where it's going</h2>
          {categoryTotals.length === 0 ? (
            <p className="muted">Nothing logged in this period yet.</p>
          ) : (
            <>
              <div className="wall wall-thin" style={{ marginTop: 10 }}>
                {categoryTotals.map((c) => (
                  <div key={c.category} className="wall-seg" style={{ width: `${rangeTotal > 0 ? (c.amount / rangeTotal) * 100 : 0}%`, background: colorForCategory(c.category) }} title={`${c.category}: ${money(c.amount)}`} />
                ))}
              </div>
              <div className="legend">
                {categoryTotals.map((c) => (
                  <span key={c.category}>
                    <span className="swatch" style={{ background: colorForCategory(c.category) }} />
                    {c.category} — {money(c.amount)} ({rangeTotal > 0 ? Math.round((c.amount / rangeTotal) * 100) : 0}%)
                  </span>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="card">
          <h2 className="card-title">Last 6 months</h2>
          <div className="chart" style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={monthlyTrend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="var(--separator)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} stroke="var(--separator)" tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 100) / 10}k`} />
                <Tooltip
                  formatter={(v) => money(v)}
                  cursor={{ fill: "var(--fill-4)" }}
                  contentStyle={{ fontFamily: "var(--font)", fontSize: 13, borderRadius: 10, border: "none", background: "var(--grouped-bg-2)", color: "var(--label)", boxShadow: "0 4px 16px rgba(0,0,0,.15)" }}
                />
                <Bar dataKey="amount" fill="var(--blue)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <ListSection
          header="Transactions"
          footer="Bill payments come from the Monthly Plan, where they're edited; tap one you logged here to edit it."
        >
          <SelectField
            label="Category"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[{ value: "all", label: "All categories" }, ...availableCategories]}
          />
          {filtered.length === 0 && <div className="row muted">No transactions in this period.</div>}
          {filtered.map((e) => (
            <ListRow
              key={e.id}
              icon={<span className="dot" />}
              iconColor={colorForCategory(chartCategoryOf(e))}
              className="tx-row"
              title={<>{e.note || e.category}{e.source === "manual" && e.receiptPath && <ImageIcon size={14} className="inline-icon muted" aria-label="Has receipt" />}</>}
              subtitle={`${e.category}${e.source === "bill" ? (e.extra ? " · extra payment" : " · bill payment") : ""} · ${e.date ? fmtDate(new Date(e.date + "T00:00:00")) : "—"}`}
              detail={<span className="num">{money(e.amount)}</span>}
              onClick={e.source === "manual" ? () => { if (!guardSandbox()) setEditing(e); } : undefined}
            />
          ))}
        </ListSection>
      </div>

      {editing && (
        <ExpenseEditorSheet
          expense={editingExpense}
          onSave={saveExpense}
          onDelete={() => editingExpense && deleteExpense(editingExpense)}
          onViewReceipt={openReceipt}
          onClose={() => setEditing(null)}
        />
      )}
      {viewingReceipt && (
        <Sheet title="Receipt" onClose={() => setViewingReceipt(null)}>
          <img src={viewingReceipt} alt="Receipt" className="receipt-full" />
        </Sheet>
      )}
    </>
  );
}
