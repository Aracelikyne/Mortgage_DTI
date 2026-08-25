import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Plus, Trash2, Pencil, Receipt, X, Image as ImageIcon } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { derivedBillExpenses, money, monthKeyOf, fmtDate } from "../utils/finance";
import AddExpenseModal from "./AddExpenseModal";

// A category's color has to mean the same thing every time it appears, no
// matter what's filtered in or out — so this is a fixed lookup by name, not
// an index into whatever's currently visible. Validated (see the dataviz
// skill) against this app's own card surface, not a generic white — see
// supabase/expenses_migration.sql's neighbor comments for why "Bills" gets
// its own bucket instead of one slot per individual bill category: bill-
// level detail already lives on the Debts/Fixed tabs, so lumping every
// payment under one "Bills" identity here keeps the chart about the thing
// this tab actually exists to show — discretionary spending.
const CATEGORY_COLOR_ORDER = ["Bills", "Groceries", "Gas", "Fast Food", "Dining Out", "Shopping", "Entertainment", "Health"];
const CATEGORY_PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const OTHER_COLOR = "#8A8272";

function colorForCategory(category) {
  const idx = CATEGORY_COLOR_ORDER.indexOf(category);
  return idx >= 0 ? CATEGORY_PALETTE[idx] : OTHER_COLOR;
}

// The category identity used for the breakdown chart/legend — every bill
// payment folds into one "Bills" slice there, regardless of which specific
// bill it was. The transaction list below still shows the real bill name
// and category, this only affects the aggregate chart.
function chartCategoryOf(e) {
  return e.source === "bill" ? "Bills" : (e.category || "Other");
}

const RANGE_OPTIONS = [
  { key: "month", label: "This month" },
  { key: "3months", label: "Last 3 months" },
  { key: "6months", label: "Last 6 months" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
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

export default function ExpenseTracker({ debts, fixed, paidByMonth, userId, userName }) {
  const [rows, setRows] = useState(null); // null = loading
  const [loadError, setLoadError] = useState(null);
  const [range, setRange] = useState("month");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [signedUrls, setSignedUrls] = useState({});
  const [viewingReceipt, setViewingReceipt] = useState(null);

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

  const billExpenses = useMemo(() => derivedBillExpenses(debts, fixed, paidByMonth), [debts, fixed, paidByMonth]);
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

  const availableCategories = useMemo(
    () => [...new Set(rangeFiltered.map((e) => e.category || "Other"))].sort(),
    [rangeFiltered]
  );

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
    return [...byCategory.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [rangeFiltered]);

  const rangeTotal = categoryTotals.reduce((s, c) => s + c.amount, 0);
  const topCategory = categoryTotals[0]?.category || "—";

  const monthlyTrend = useMemo(() => {
    const byMonth = new Map();
    // Trend always looks back over the last 6 months regardless of the
    // pill filter above — a one-month bar chart isn't a trend.
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

  async function getSignedUrl(path) {
    if (signedUrls[path]) return signedUrls[path];
    const { data, error } = await supabase.storage.from("receipts").createSignedUrl(path, 3600);
    if (error) { console.error(error); return null; }
    setSignedUrls((prev) => ({ ...prev, [path]: data.signedUrl }));
    return data.signedUrl;
  }

  async function openReceipt(path) {
    const url = await getSignedUrl(path);
    if (url) setViewingReceipt(url);
  }

  async function saveExpense(form, receiptFile) {
    let receiptPath = editingExpense?.receiptPath || null;
    if (receiptFile) {
      const ext = receiptFile.name.split(".").pop() || "jpg";
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("receipts").upload(path, receiptFile);
      if (uploadError) { console.error(uploadError); throw uploadError; }
      receiptPath = path;
    }
    const payload = {
      amount: Number(form.amount),
      category: form.category,
      note: form.note || null,
      date: form.date,
      receipt_path: receiptPath,
    };
    if (editingExpense) {
      const { error } = await supabase.from("expenses").update(payload).eq("id", editingExpense.rawId);
      if (error) throw error;
      setRows((prev) => (prev || []).map((r) => (r.id === editingExpense.rawId ? { ...r, ...payload } : r)));
    } else {
      const { data, error } = await supabase
        .from("expenses")
        .insert({ ...payload, user_id: userId, user_name: userName })
        .select()
        .single();
      if (error) throw error;
      setRows((prev) => (prev && prev.some((r) => r.id === data.id) ? prev : [data, ...(prev || [])]));
    }
    setShowAdd(false);
    setEditingExpense(null);
  }

  async function deleteExpense(expense) {
    setRows((prev) => (prev || []).filter((r) => r.id !== expense.rawId));
    const { error } = await supabase.from("expenses").delete().eq("id", expense.rawId);
    if (error) console.error(error);
    if (expense.receiptPath) {
      await supabase.storage.from("receipts").remove([expense.receiptPath]);
    }
  }

  return (
    <div style={{ marginTop: 4 }}>
      <div className="ctc-section-head">
        <div className="ctc-h2"><Receipt size={18} /> Expenses</div>
        <button className="btn btn-primary btn-sm" onClick={() => { setEditingExpense(null); setShowAdd(true); }}>
          <Plus size={13} /> Log expense
        </button>
      </div>

      {loadError && <div className="warning-box">{loadError}</div>}

      <div className="strategy-pills" style={{ marginBottom: 16 }}>
        {RANGE_OPTIONS.map((r) => (
          <button key={r.key} className={`pill ${range === r.key ? "active" : ""}`} onClick={() => setRange(r.key)}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Total spent</div>
          <div className="stat-value brick">{money(total)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Transactions</div>
          <div className="stat-value">{txCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Average per transaction</div>
          <div className="stat-value">{money(avgTx)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Top category</div>
          <div className="stat-value" style={{ fontSize: 17 }}>{topCategory}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="wall-title" style={{ marginBottom: 10 }}>Where it's going</div>
        {categoryTotals.length === 0 ? (
          <div className="ctc-hint">Nothing logged in this period yet.</div>
        ) : (
          <>
            <div className="wall-track">
              {categoryTotals.map((c) => (
                <div
                  key={c.category}
                  className="wall-seg"
                  style={{ width: `${rangeTotal > 0 ? (c.amount / rangeTotal) * 100 : 0}%`, background: colorForCategory(c.category) }}
                  title={`${c.category}: ${money(c.amount)}`}
                />
              ))}
            </div>
            <div className="wall-legend" style={{ marginTop: 12 }}>
              {categoryTotals.map((c) => (
                <span key={c.category}>
                  <span className="swatch" style={{ background: colorForCategory(c.category) }} />
                  {c.category} — {money(c.amount)} ({rangeTotal > 0 ? Math.round((c.amount / rangeTotal) * 100) : 0}%)
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="wall-title" style={{ marginBottom: 10 }}>Last 6 months</div>
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer>
            <BarChart data={monthlyTrend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#DED5BA" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} stroke="#5B6570" />
              <YAxis tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} stroke="#5B6570" tickFormatter={(v) => `${Math.round(v / 100) / 10}k`} />
              <Tooltip formatter={(v) => money(v)} contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 12, borderRadius: 4, border: "1px solid #CFC6AE" }} />
              <Bar dataKey="amount" fill="#A5473A" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="ctc-section-head" style={{ marginTop: 24 }}>
        <div className="ctc-h2" style={{ fontSize: 17 }}>Transactions</div>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="all">All categories</option>
          {availableCategories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="card">
        {filtered.length === 0 && <div className="ctc-hint">No transactions in this period.</div>}
        {filtered.map((e) => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #EFE9D9", flexWrap: "wrap" }}>
            <span className="swatch" style={{ background: colorForCategory(chartCategoryOf(e)), flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 140 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{e.note || e.category}</div>
              <div className="ctc-hint">
                {e.category}{e.source === "bill" ? " · bill payment" : ""} · {e.date ? fmtDate(new Date(e.date + "T00:00:00")) : "—"}
              </div>
            </div>
            <div className="ctc-mono" style={{ fontWeight: 600 }}>{money(e.amount)}</div>
            {e.source === "manual" && e.receiptPath && (
              <button className="btn-ghost btn-sm" style={{ border: "none" }} title="View receipt" onClick={() => openReceipt(e.receiptPath)}>
                <ImageIcon size={14} color="var(--pine-deep)" />
              </button>
            )}
            {e.source === "manual" && (
              <>
                <button className="btn-ghost btn-sm" style={{ border: "none" }} title="Edit" onClick={() => { setEditingExpense(e); setShowAdd(true); }}>
                  <Pencil size={13} />
                </button>
                <button className="btn-ghost btn-sm" style={{ border: "none" }} title="Delete" onClick={() => deleteExpense(e)}>
                  <Trash2 size={14} color="#A5473A" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {showAdd && (
        <AddExpenseModal
          expense={editingExpense}
          onClose={() => { setShowAdd(false); setEditingExpense(null); }}
          onSave={saveExpense}
        />
      )}

      {viewingReceipt && (
        <div className="modal-overlay" onClick={() => setViewingReceipt(null)}>
          <div className="modal" style={{ maxWidth: 480, padding: 10 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn-ghost btn-sm" style={{ border: "none" }} onClick={() => setViewingReceipt(null)}><X size={16} /></button>
            </div>
            <img src={viewingReceipt} alt="Receipt" style={{ width: "100%", borderRadius: 4, display: "block" }} />
          </div>
        </div>
      )}
    </div>
  );
}
