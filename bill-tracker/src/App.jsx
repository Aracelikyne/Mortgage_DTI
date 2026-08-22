import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";
import {
  Home, KeyRound, Lock, Plus, Trash2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Wallet, TrendingDown, Sparkles, PiggyBank, Calendar, LogOut, CheckCircle2, Circle
} from "lucide-react";

// Import your extracted logic and components
import { CATEGORY_OPTIONS, FIXED_CATEGORY_OPTIONS, TIERS, initialDebts, initialFixed, nextId } from "./data/constants";
import { allocateExtra, allocateMaxCashFlow, buildPaycheckPlan, fastestStrategyForBoost, minimumAdjustedDebts, money, monthLabel, monthLabelFull, pct, simulatePayoff, fmtDate, monthKeyOf, getPaymentRecord, isoDate } from "./utils/finance";
import AddDebtModal from "./components/AddDebtModal";
import AddFixedModal from "./components/AddFixedModal";
import { supabase } from "./lib/supabaseClient";

// One-time migration from the old localStorage-only version of the app.
function readLegacyLocalState() {
  try {
    const raw = localStorage.getItem("bill-tracker-state");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking, null = signed out
  const [saved, setSaved] = useState(null); // null until the row has been fetched
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) setSaved(null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    supabase
      .from("app_state")
      .select("data")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error(error);
          setLoadError("Couldn't reach your saved data in Supabase — starting blank, and edits may not save until this is fixed. Check the browser console for details.");
          setSaved({});
          return;
        }

        if (data?.data) {
          setSaved(data.data);
          return;
        }

        // No row in Supabase yet — check for data from the old localStorage-only
        // version of this app, on this browser, and import it once so nothing
        // has to be re-entered.
        const legacy = readLegacyLocalState();
        if (legacy && Object.keys(legacy).length > 0) {
          const { error: upsertError } = await supabase.from("app_state").upsert({
            user_id: session.user.id,
            data: legacy,
            updated_at: new Date().toISOString(),
          });
          if (cancelled) return;
          if (upsertError) {
            console.error(upsertError);
            setLoadError("Couldn't save your imported data to Supabase — the app_state table may be missing (see supabase/schema.sql). Your edits from here may not save either.");
          }
          setSaved(legacy);
          return;
        }

        setSaved({});
      });
    return () => { cancelled = true; };
  }, [session]);

  if (session === undefined) {
    return <AuthScreen loading />;
  }
  if (!session) {
    return <AuthScreen />;
  }
  if (saved === null) {
    return <AuthScreen loading />;
  }
  return (
    <>
      {loadError && (
        <div style={{
          background: "#F0D8D3", color: "#6B2E26", borderBottom: "1px solid #DDB4AA",
          padding: "10px 20px", fontSize: 13, fontFamily: "Inter, sans-serif", textAlign: "center",
        }}>
          {loadError}
        </div>
      )}
      <BillTracker key={session.user.id} saved={saved} userId={session.user.id} />
    </>
  );
}

function AuthScreen({ loading }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#ECE6D6", fontFamily: "Inter, sans-serif" }}>
      <div style={{ background: "#F6F2E7", border: "1px solid #CFC6AE", borderRadius: 6, padding: "32px 36px", textAlign: "center", maxWidth: 360 }}>
        <div style={{ fontFamily: "Fraunces, serif", fontWeight: 600, fontSize: 22, marginBottom: 8 }}>Clear to Close</div>
        {loading ? (
          <div style={{ color: "#5B6570", fontSize: 14 }}>Loading…</div>
        ) : (
          <>
            <p style={{ color: "#5B6570", fontSize: 14, marginBottom: 18 }}>Sign in to see and edit your data.</p>
            <button
              onClick={() =>
                supabase.auth.signInWithOAuth({
                  provider: "github",
                  options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
                })
              }
              style={{
                fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 13.5, padding: "9px 16px",
                borderRadius: 3, border: "1px solid #22282E", cursor: "pointer", background: "#22282E", color: "#ECE6D6",
              }}
            >
              Sign in with GitHub
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function BillTracker({ saved, userId }) {
  const [debts, setDebts] = useState(saved.debts || initialDebts);
  const [fixed, setFixed] = useState(saved.fixed || initialFixed);
  const [income, setIncome] = useState(saved.income ?? 15000);
  const [netIncome, setNetIncome] = useState(saved.netIncome ?? "");
  const [includeRent, setIncludeRent] = useState(saved.includeRent ?? false);
  const [recurringExtra, setRecurringExtra] = useState(saved.recurringExtra ?? 0);
  const [strategy, setStrategy] = useState(saved.strategy || "tiered");
  const [targetDTI, setTargetDTI] = useState(saved.targetDTI ?? 43);
  const [mortgageEstimate, setMortgageEstimate] = useState(saved.mortgageEstimate ?? 3000);
  const [incomeSources, setIncomeSources] = useState(saved.incomeSources || [
    { id: nextId(), name: "Your paycheck", amount: "", nextPayDate: "", frequency: "biweekly" },
    { id: nextId(), name: "Partner's paycheck", amount: "", nextPayDate: "", frequency: "biweekly" },
  ]);
  const [boosts, setBoosts] = useState(saved.boosts || []);
  const [paidByMonth, setPaidByMonth] = useState(saved.paidByMonth || {});
  const [page, setPage] = useState("dashboard");

  const [extraAmount, setExtraAmount] = useState("");
  const [suggestion, setSuggestion] = useState(null);
  const [showAddDebt, setShowAddDebt] = useState(false);
  const [showAddFixed, setShowAddFixed] = useState(false);
  const [collapsedTiers, setCollapsedTiers] = useState({});
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const saveTimer = useRef(null);

  // ---- persistence ----
  const isFirstRender = useRef(true);
  const latestState = useRef(null);
  useEffect(() => {
    latestState.current = { debts, fixed, income, netIncome, includeRent, recurringExtra, strategy, targetDTI, mortgageEstimate, incomeSources, boosts, paidByMonth };
  });

  const flushSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setSaveStatus("saving");
    supabase
      .from("app_state")
      .upsert({
        user_id: userId,
        data: latestState.current,
        updated_at: new Date().toISOString(),
      })
      .then(({ error }) => {
        setSaveStatus(error ? "error" : "saved");
        if (error) console.error(error);
      });
  }, [userId]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 700);
    return () => clearTimeout(saveTimer.current);
  }, [debts, fixed, income, netIncome, includeRent, recurringExtra, strategy, targetDTI, mortgageEstimate, incomeSources, boosts, paidByMonth, flushSave]);

  // Flush immediately when the tab is backgrounded/closed instead of losing a
  // pending debounced save — visibilitychange fires reliably before teardown,
  // unlike beforeunload.
  useEffect(() => {
    const handleHide = () => {
      if (document.visibilityState === "hidden" && saveTimer.current) {
        flushSave();
      }
    };
    document.addEventListener("visibilitychange", handleHide);
    window.addEventListener("pagehide", handleHide);
    return () => {
      document.removeEventListener("visibilitychange", handleHide);
      window.removeEventListener("pagehide", handleHide);
    };
  }, [flushSave]);

  // ---- derived numbers ----
  const debtBills = debts.filter((d) => d.isDebt !== false);
  const totalDebtMonthly = debtBills.reduce((s, d) => s + Number(d.monthly || 0), 0);
  const totalDebtBalance = debtBills.reduce((s, d) => s + Number(d.balance || 0), 0);
  const rentMonthly = fixed.find((f) => f.type === "Rent/Mortgage")?.monthly || 0;
  const dtiNumerator = totalDebtMonthly + (includeRent ? rentMonthly : 0);
  const dti = income > 0 ? (dtiNumerator / income) * 100 : null;
  // "true" qualifying DTI a lender would see today: current debts + the future mortgage,
  // replacing current rent (you won't be paying both at once)
  const trueDtiNumerator = totalDebtMonthly + Number(mortgageEstimate || 0);
  const trueDti = income > 0 ? (trueDtiNumerator / income) * 100 : null;

  const totalFixedMonthly = fixed.reduce((s, f) => s + Number(f.monthly || 0), 0);
  const netIncomeNum = netIncome === "" ? null : Number(netIncome);
  const availableAfterBills = netIncomeNum !== null ? netIncomeNum - totalDebtMonthly - totalFixedMonthly : null;

  const sim = useMemo(
    () => simulatePayoff(debts, Number(recurringExtra) || 0, boosts, strategy, { income, targetDTI: Number(targetDTI) || null, mortgageEstimate: Number(mortgageEstimate) || 0 }),
    [debts, recurringExtra, boosts, strategy, income, targetDTI, mortgageEstimate]
  );

  const debtFreeLabel = sim.freedomMonth !== null ? monthLabelFull(sim.freedomMonth) : "480+ months out";
  const fullDebtFreeLabel = sim.fullFreedomMonth !== null ? monthLabelFull(sim.fullFreedomMonth) : "480+ months out";
  const dtiTargetLabel = sim.dtiTargetMonth === 0 ? "Already there" : sim.dtiTargetMonth !== null ? monthLabelFull(sim.dtiTargetMonth) : "480+ months out";
  const dtiWithMortgageTargetLabel = sim.dtiWithMortgageTargetMonth === 0 ? "Already there" : sim.dtiWithMortgageTargetMonth !== null ? monthLabelFull(sim.dtiWithMortgageTargetMonth) : "480+ months out";
  const hasExcludedWithBalance = debts.some((d) => d.excludeFromGoal && d.isDebt !== false && d.balance > 0);

  const paycheckPlan = useMemo(() => {
    const billsForPlan = [
      ...debts.filter((d) => d.isDebt !== false).map((d) => ({ id: d.id, name: d.name, monthly: d.monthly, dueDay: d.dueDay, graceDays: d.graceDays, splitFriendly: d.splitFriendly })),
      ...fixed.map((f) => ({ id: f.id, name: f.name, monthly: f.monthly, dueDay: f.dueDay, graceDays: f.graceDays, splitFriendly: f.splitFriendly })),
    ];
    return buildPaycheckPlan(incomeSources, billsForPlan, 95, paidByMonth);
  }, [incomeSources, debts, fixed, paidByMonth]);


  // chart sampling
  const chartData = useMemo(() => {
    const s = sim.series;
    if (s.length <= 48) return s;
    const step = Math.ceil(s.length / 48);
    const out = s.filter((_, i) => i % step === 0 || i === s.length - 1);
    return out;
  }, [sim.series]);

  const [wallBaseline] = useState(() => debts.reduce((s, d) => s + Number(d.balance || 0), 0) || 1);
  function startingTotalRef() {
    // stable baseline captured on first load, used only for the wall visual proportion
    return wallBaseline;
  }

  const tierGroups = [1, 2, 3, 4].map((t) => ({
    tier: t,
    items: debts.filter((d) => d.priority === t),
  }));
  const protectedGroup = debts.filter((d) => d.protected);

  function updateDebt(id, patch) {
    setDebts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }
  function removeDebt(id) {
    setDebts((prev) => prev.filter((d) => d.id !== id));
  }
  function addDebt(newDebt) {
    setDebts((prev) => [...prev, { id: nextId(), excludeFromGoal: false, protected: false, apr: null, dueDay: null, ...newDebt }]);
    setShowAddDebt(false);
  }
  function updateFixed(id, patch) {
    setFixed((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }
  function removeFixed(id) {
    setFixed((prev) => prev.filter((f) => f.id !== id));
  }
  function addFixed(newFixed) {
    setFixed((prev) => [...prev, { id: nextId(), note: "", dueDay: null, graceDays: 0, ...newFixed }]);
    setShowAddFixed(false);
  }

  function updateIncomeSource(id, patch) {
    setIncomeSources((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function removeIncomeSource(id) {
    setIncomeSources((prev) => prev.filter((s) => s.id !== id));
  }
  function addIncomeSource() {
    setIncomeSources((prev) => [...prev, { id: nextId(), name: "New paycheck", amount: "", nextPayDate: "", frequency: "biweekly" }]);
  }

  function buildRows(applied, sourceDebts) {
    return sourceDebts
      .filter((d) => applied[d.id])
      .map((d) => {
        const newBalance = Math.max(0, d.balance - applied[d.id]);
        return { id: d.id, name: d.name, applied: applied[d.id], newBalance, paidOff: newBalance <= 0 };
      });
  }

  const STRATEGY_LABEL = { tiered: "your tiers", snowball: "snowball", avalanche: "avalanche", maxcashflow: "the cash-flow combo" };

  function runSuggestion() {
    const amt = Number(extraAmount);
    if (!amt || amt <= 0) return;

    // knock out this month's already-budgeted minimums first — only what's left needs extra dollars
    const adjusted = minimumAdjustedDebts(debts);

    const cash = allocateMaxCashFlow(adjusted, amt);
    const interest = allocateExtra(adjusted, amt, "avalanche");
    const fastestPick = fastestStrategyForBoost(debts, amt, Number(recurringExtra) || 0, boosts);
    const fastestApplied = fastestPick.strategy === "maxcashflow" ? cash.applied : allocateExtra(adjusted, amt, fastestPick.strategy).applied;
    const fastestSpent = Object.values(fastestApplied).reduce((s, v) => s + v, 0);

    setSuggestion({
      amt,
      cashFlow: { rows: buildRows(cash.applied, adjusted), leftover: cash.leftover, freedMonthly: cash.freedMonthly },
      interestCost: { rows: buildRows(interest.applied, adjusted), leftover: interest.leftover },
      fastest: {
        rows: buildRows(fastestApplied, adjusted),
        leftover: Math.max(0, amt - fastestSpent),
        strategyLabel: STRATEGY_LABEL[fastestPick.strategy],
        freedomMonth: fastestPick.freedomMonth,
      },
    });
  }


  function applySuggestionLens(lensKey) {
    if (!suggestion || !suggestion[lensKey]) return;
    const rows = suggestion[lensKey].rows;
    setDebts((prev) =>
      prev.map((d) => {
        const row = rows.find((r) => r.id === d.id);
        return row ? { ...d, balance: row.newBalance } : d;
      })
    );
    setSuggestion(null);
    setExtraAmount("");
  }

  const dtiBand = dti === null ? null : dti <= 36 ? "good" : dti <= 43 ? "watch" : "over";
  const dtiBandLabel = { good: "Within typical guidelines", watch: "Near the common ceiling", over: "Above the common ceiling" }[dtiBand] || "";

  return (
    <div className="ctc-app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

        .ctc-app {
          --paper: #ECE6D6;
          --card: #F6F2E7;
          --ink: #22282E;
          --ink-soft: #5B6570;
          --line: #CFC6AE;
          --brass: #B8863F;
          --brass-deep: #8F6A2E;
          --brick: #A5473A;
          --pine: #3C6E47;
          --pine-deep: #2C5236;
          --lav: #8C6A9C;
          --neutral: #8A8272;
          font-family: 'Inter', sans-serif;
          background: var(--paper);
          color: var(--ink);
          min-height: 100%;
          padding: 28px 20px 60px;
          box-sizing: border-box;
        }
        .ctc-app * { box-sizing: border-box; }
        .ctc-mono { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
        .ctc-shell { max-width: 980px; margin: 0 auto; }

        .ctc-eyebrow {
          font-family: 'IBM Plex Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          font-size: 11px;
          color: var(--brass-deep);
          font-weight: 600;
        }
        .ctc-title {
          font-family: 'Fraunces', serif;
          font-weight: 600;
          font-size: 40px;
          line-height: 1.05;
          margin: 6px 0 4px;
          letter-spacing: -0.01em;
        }
        .ctc-sub { color: var(--ink-soft); font-size: 14.5px; max-width: 60ch; }

        /* --- signature: the wall --- */
        .wall-wrap {
          margin-top: 26px;
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: 4px;
          padding: 20px 22px;
        }
        .wall-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
        .wall-title { font-family: 'Fraunces', serif; font-size: 17px; font-weight: 600; }
        .wall-meta { font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: var(--ink-soft); }
        .wall-track {
          position: relative;
          height: 30px;
          background: repeating-linear-gradient(90deg, #DED5BA, #DED5BA 1px, transparent 1px, transparent 14px), #E4DCC5;
          border: 1px solid var(--line);
          border-radius: 2px;
          overflow: hidden;
          display: flex;
        }
        .wall-seg { height: 100%; transition: width 0.5s ease; }
        .wall-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
        .wall-legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11.5px; color: var(--ink-soft); }
        .wall-legend span { display: inline-flex; align-items: center; gap: 5px; }
        .swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
        .wall-key {
          display: flex; align-items: center; gap: 6px;
          font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 600;
          color: var(--pine-deep);
        }

        .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 16px; }
        @media (max-width: 760px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
        .stat-card { background: var(--card); border: 1px solid var(--line); border-radius: 4px; padding: 14px 16px; }
        .stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-soft); font-weight: 600; }
        .stat-value { font-family: 'IBM Plex Mono', monospace; font-size: 22px; font-weight: 600; margin-top: 4px; }
        .stat-value.brick { color: var(--brick); }
        .stat-value.pine { color: var(--pine-deep); }
        .stat-value.brass { color: var(--brass-deep); }

        .ctc-section { margin-top: 34px; }
        .ctc-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
        .ctc-h2 { font-family: 'Fraunces', serif; font-size: 21px; font-weight: 600; display:flex; align-items:center; gap:8px;}
        .ctc-hint { font-size: 12.5px; color: var(--ink-soft); }

        .card { background: var(--card); border: 1px solid var(--line); border-radius: 4px; padding: 18px 20px; }

        .field-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; }
        .field label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-soft); font-weight: 600; margin-bottom: 5px; }
        .field input, .field select {
          width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 3px;
          background: #fff; font-family: 'IBM Plex Mono', monospace; font-size: 14px; color: var(--ink);
        }
        .field select { font-family: 'Inter', sans-serif; }
        .field input:focus, .field select:focus { outline: 2px solid var(--brass); outline-offset: 1px; }

        .toggle-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-soft); margin-top: 10px; }
        .toggle-row input { accent-color: var(--brass-deep); }

        .dti-gauge { position: relative; height: 34px; border-radius: 3px; overflow: hidden; margin-top: 14px; border: 1px solid var(--line); }
        .dti-band { position: absolute; top: 0; bottom: 0; }
        .dti-marker { position: absolute; top: -4px; bottom: -4px; width: 3px; background: var(--ink); }
        .dti-scale { display:flex; justify-content: space-between; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--ink-soft); margin-top: 4px; }

        .strategy-pills { display: flex; gap: 8px; flex-wrap: wrap; }
        .pill {
          padding: 7px 13px; border: 1px solid var(--line); border-radius: 20px; font-size: 12.5px; font-weight: 600;
          cursor: pointer; background: #fff; color: var(--ink-soft); transition: all .15s;
        }
        .pill.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }

        .btn {
          font-family: 'Inter', sans-serif; font-weight: 600; font-size: 13.5px;
          padding: 9px 16px; border-radius: 3px; border: 1px solid var(--ink); cursor: pointer;
          display: inline-flex; align-items: center; gap: 6px;
        }
        .btn-primary { background: var(--ink); color: var(--paper); }
        .btn-primary:hover { background: #384049; }
        .btn-ghost { background: transparent; color: var(--ink); }
        .btn-ghost:hover { background: rgba(0,0,0,0.04); }
        .btn-sm { padding: 5px 10px; font-size: 12px; }

        .suggestion-box { margin-top: 14px; border-top: 1px dashed var(--line); padding-top: 14px; }
        .lens-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        @media (max-width: 760px) { .lens-grid { grid-template-columns: 1fr; } }
        .lens-card { background: #fff; border: 1px solid var(--line); border-radius: 4px; padding: 12px 14px; }
        .lens-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 13.5px; margin-bottom: 4px; }
        .lens-metric { font-family: 'IBM Plex Mono', monospace; font-size: 15px; font-weight: 600; color: var(--pine-deep); margin-bottom: 8px; }
        .sugg-row { display: flex; justify-content: space-between; font-size: 13.5px; padding: 6px 0; border-bottom: 1px solid #EFE9D9; }
        .sugg-row:last-child { border-bottom: none; }

        table.ledger { width: 100%; border-collapse: collapse; font-size: 13px; }
        table.ledger th {
          text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em;
          color: var(--ink-soft); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--line);
        }
        table.ledger td { padding: 7px 8px; border-bottom: 1px solid #EFE9D9; }
        table.ledger input, table.ledger select {
          width: 100%; min-width: 36px; border: 1px solid transparent; background: transparent; padding: 4px 5px; border-radius: 3px;
          font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: var(--ink);
        }
        table.ledger input:hover, table.ledger select:hover { border-color: var(--line); }
        table.ledger input:focus, table.ledger select:focus { outline: none; border-color: var(--brass); background: #fff; }
        table.ledger select { font-family: 'Inter', sans-serif; }

        .tier-head {
          display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 10px 4px;
          font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; user-select: none;
        }
        .tier-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .tier-sum { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--ink-soft); font-weight: 400; margin-left: auto; }

        .protected-note {
          font-size: 12px; color: var(--ink-soft); background: #EFE9D9; border-radius: 3px; padding: 8px 12px; margin-top: 8px;
        }

        .warning-box {
          font-size: 12.5px; color: #6B2E26; background: #F0D8D3; border: 1px solid #DDB4AA; border-radius: 3px;
          padding: 10px 12px; margin-bottom: 14px; line-height: 1.5;
        }

        .paycheck-row { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 6px; margin-top: 4px; }
        .paycheck-card {
          flex: 0 0 220px; background: #fff; border: 1px solid var(--line); border-radius: 4px; padding: 12px 14px;
          display: flex; flex-direction: column;
        }
        .paycheck-date { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14px; }
        .paycheck-source { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-soft); margin-bottom: 10px; }
        .paycheck-items { flex: 1; display: flex; flex-direction: column; gap: 5px; min-height: 20px; }
        .paycheck-item { display: flex; justify-content: space-between; font-size: 12px; gap: 6px; }
        .paycheck-item span:first-child { display: flex; align-items: center; gap: 5px; }
        .split-badge {
          font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; background: #F0E3C4; color: var(--brass-deep);
          padding: 1px 5px; border-radius: 8px; white-space: nowrap;
        }
        .paycheck-leftover {
          font-size: 11.5px; font-weight: 600; margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--line);
        }
        .paycheck-leftover.pine { color: var(--pine-deep); }
        .paycheck-leftover.brick { color: var(--brick); }

        .modal-overlay { position: fixed; inset: 0; background: rgba(34,40,46,0.45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
        .modal { background: var(--paper); border: 1px solid var(--line); border-radius: 5px; padding: 22px; width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; }
        .modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .modal-head h3 { font-family: 'Fraunces', serif; font-size: 18px; }
        .modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }

        .footnote { font-size: 12px; color: var(--ink-soft); margin-top: 30px; border-top: 1px solid var(--line); padding-top: 14px; line-height: 1.6; }
      `}</style>

      <div className="ctc-shell">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="ctc-eyebrow">Debt payoff & DTI tracker</div>
            <h1 className="ctc-title">Clear to Close</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="ctc-hint" style={{ minWidth: 64, textAlign: "right" }}>
              {saveStatus === "saving" && "Saving…"}
              {saveStatus === "saved" && "Saved"}
              {saveStatus === "error" && <span style={{ color: "var(--brick)" }}>Couldn't save</span>}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => supabase.auth.signOut()}><LogOut size={13} /> Sign out</button>
          </div>
        </div>

        <div className="strategy-pills" style={{ marginTop: 10, marginBottom: 4 }}>
          <button className={`pill ${page === "dashboard" ? "active" : ""}`} onClick={() => setPage("dashboard")}>Dashboard</button>
          <button className={`pill ${page === "monthly" ? "active" : ""}`} onClick={() => setPage("monthly")}>Monthly plan</button>
        </div>

        {page === "dashboard" && (
        <>
        <p className="ctc-sub">
          Every bill you owe, one dashboard, pointed at a mortgage-ready DTI. Add income, drop in extra
          money when you have it, and this recalculates your debt-free date on its own.
        </p>

        {/* ---- the wall ---- */}
        <div className="wall-wrap">
          <div className="wall-head">
            <span className="wall-title">The wall between you and the front door</span>
            {sim.freedomMonth !== null ? (
              <span className="wall-key"><KeyRound size={14} /> Debt-free: {debtFreeLabel}</span>
            ) : (
              <span className="wall-meta">Add extra payments below to see a debt-free date</span>
            )}
          </div>
          <div className="wall-track">
            {tierGroups.map(({ tier, items }) => {
              const balance = items.reduce((s, d) => s + Number(d.balance || 0), 0);
              const baseline = startingTotalRef(debts);
              const w = baseline > 0 ? (balance / baseline) * 100 : 0;
              return <div key={tier} className="wall-seg" style={{ width: `${w}%`, background: TIERS[tier].color }} title={`${TIERS[tier].label}: ${money(balance)}`} />;
            })}
          </div>
          <div className="wall-foot">
            <div className="wall-legend">
              {Object.entries(TIERS).map(([t, v]) => (
                <span key={t}><span className="swatch" style={{ background: v.color }} />{v.label}</span>
              ))}
            </div>
            <div className="wall-meta ctc-mono">{money(totalDebtBalance)} remaining</div>
          </div>
        </div>

        {/* ---- stat cards ---- */}
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Total debt balance</div>
            <div className="stat-value brick">{money(totalDebtBalance)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Monthly debt payments</div>
            <div className="stat-value">{money(totalDebtMonthly)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Current DTI</div>
            <div className={`stat-value ${dtiBand === "good" ? "pine" : dtiBand === "over" ? "brick" : "brass"}`}>{pct(dti)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Target debt-free</div>
            <div className="stat-value pine" style={{ fontSize: 17 }}>{debtFreeLabel}</div>
          </div>
        </div>
        <div className="stat-grid" style={{ marginTop: 12 }}>
          <div className="stat-card">
            <div className="stat-label">True DTI (incl. {money(mortgageEstimate)} mortgage)</div>
            <div className={`stat-value ${trueDti !== null && trueDti <= targetDTI ? "pine" : "brick"}`} style={{ fontSize: 20 }}>{pct(trueDti)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Under {targetDTI || 0}% DTI by</div>
            <div className="stat-value brass" style={{ fontSize: 17 }}>{dtiTargetLabel}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Mortgage-ready by ({targetDTI || 0}% w/ mortgage)</div>
            <div className="stat-value brass" style={{ fontSize: 17 }}>{dtiWithMortgageTargetLabel}</div>
          </div>
          {hasExcludedWithBalance && (
            <div className="stat-card">
              <div className="stat-label">Total debt-free (incl. forever loans)</div>
              <div className="stat-value" style={{ fontSize: 17 }}>{fullDebtFreeLabel}</div>
            </div>
          )}
          {availableAfterBills !== null && (
            <div className="stat-card">
              <div className="stat-label">Available toward debt each month (net income)</div>
              <div className={`stat-value ${availableAfterBills < 0 ? "brick" : "pine"}`} style={{ fontSize: 17 }}>{money(availableAfterBills)}</div>
            </div>
          )}
        </div>

        {/* ---- income & DTI ---- */}
        <div className="ctc-section">
          <div className="ctc-section-head">
            <div className="ctc-h2"><Wallet size={18} /> Income & DTI</div>
          </div>
          <div className="card">
            <div className="field-row">
              <div className="field">
                <label>Gross monthly income</label>
                <input type="number" value={income} onChange={(e) => setIncome(Number(e.target.value))} />
              </div>
              <div className="field">
                <label>Net take-home pay</label>
                <input type="number" placeholder="after taxes" value={netIncome} onChange={(e) => setNetIncome(e.target.value)} />
              </div>
              <div className="field">
                <label>Monthly debt payments</label>
                <input type="text" disabled value={money(totalDebtMonthly)} />
              </div>
              <div className="field">
                <label>Fixed expenses (rent, utilities…)</label>
                <input type="text" disabled value={money(totalFixedMonthly)} />
              </div>
            </div>
            <div className="toggle-row">
              <input type="checkbox" checked={includeRent} onChange={(e) => setIncludeRent(e.target.checked)} id="rentToggle" />
              <label htmlFor="rentToggle">Include current rent ({money(rentMonthly)}) in the DTI calculation</label>
            </div>
            <div className="ctc-hint" style={{ marginTop: 10 }}>
              Gross drives the DTI number above — that's what lenders use. Net take-home drives "available to put toward debt"
              below, since that's what's actually in your account each month.
            </div>
            {netIncomeNum !== null && (
              <div className="protected-note" style={{ marginTop: 10 }}>
                Available after debt payments and fixed expenses: <strong className="ctc-mono">{money(availableAfterBills)}</strong>
                {availableAfterBills !== null && availableAfterBills < 0 && " — you're running a monthly shortfall on paper; worth double-checking the numbers above."}
              </div>
            )}

            <div className="ctc-hint" style={{ marginTop: 4, fontWeight: 600, color: "var(--ink)" }}>Today — current debts only</div>
            <div className="dti-gauge">
              <div className="dti-band" style={{ left: "0%", width: "36%", background: "#DCE6DB" }} />
              <div className="dti-band" style={{ left: "36%", width: "7%", background: "#F0E3C4" }} />
              <div className="dti-band" style={{ left: "43%", width: "27%", background: "#F0D8D3" }} />
              {dti !== null && <div className="dti-marker" style={{ left: `${Math.min(100, dti)}%` }} title={`Your DTI: ${pct(dti)}`} />}
            </div>
            <div className="dti-scale"><span>0%</span><span>36% typical comfort line</span><span>43% common QM ceiling</span><span>70%+</span></div>
            {dti !== null && <div className="ctc-hint" style={{ marginTop: 8 }}>{dtiBandLabel} — lenders vary, and this isn't lending advice, just a general reference point.</div>}

            <div style={{ marginTop: 18, borderTop: "1px dashed var(--line)", paddingTop: 14 }}>
              <div className="field-row" style={{ alignItems: "end" }}>
                <div className="field">
                  <label>Estimated future mortgage payment</label>
                  <input type="number" value={mortgageEstimate} onChange={(e) => setMortgageEstimate(e.target.value)} />
                </div>
              </div>
              <div className="ctc-hint" style={{ marginTop: 8, marginBottom: 4 }}>
                This is the DTI a lender actually calculates when you apply — your current debts plus the mortgage payment
                itself, since current rent goes away once you buy.
              </div>
              <div className="ctc-hint" style={{ fontWeight: 600, color: "var(--ink)" }}>With a {money(mortgageEstimate)}/mo mortgage</div>
              <div className="dti-gauge">
                <div className="dti-band" style={{ left: "0%", width: "36%", background: "#DCE6DB" }} />
                <div className="dti-band" style={{ left: "36%", width: "7%", background: "#F0E3C4" }} />
                <div className="dti-band" style={{ left: "43%", width: "27%", background: "#F0D8D3" }} />
                {trueDti !== null && <div className="dti-marker" style={{ left: `${Math.min(100, trueDti)}%`, background: "var(--brick)" }} title={`True DTI: ${pct(trueDti)}`} />}
              </div>
              <div className="dti-scale"><span>0%</span><span>36%</span><span>43%</span><span>70%+</span></div>
            </div>

            <div style={{ marginTop: 18, borderTop: "1px dashed var(--line)", paddingTop: 14 }}>
              <div className="field-row" style={{ alignItems: "end" }}>
                <div className="field">
                  <label>Your target DTI, as a couple</label>
                  <input type="number" value={targetDTI} onChange={(e) => setTargetDTI(e.target.value)} />
                </div>
                <div className="field" style={{ flex: "0 0 auto" }}>
                  <div className="strategy-pills">
                    <button className={`pill ${Number(targetDTI) === 36 ? "active" : ""}`} onClick={() => setTargetDTI(36)}>36% conventional</button>
                    <button className={`pill ${Number(targetDTI) === 43 ? "active" : ""}`} onClick={() => setTargetDTI(43)}>43% FHA / safe</button>
                    <button className={`pill ${Number(targetDTI) === 50 ? "active" : ""}`} onClick={() => setTargetDTI(50)}>50% strong file</button>
                  </div>
                </div>
              </div>
              <div className="ctc-hint" style={{ marginTop: 8 }}>
                43% clears FHA and most automated conventional approvals without needing strong credit/reserves to back it up.
                36% is the manual-underwriting ceiling and usually unlocks the best pricing. Neither is a guarantee — your
                actual lender's number can land anywhere in that range depending on credit and loan program. "Mortgage-ready
                by" above uses this target plus your mortgage estimate together.
              </div>
            </div>
          </div>
        </div>

        {/* ---- extra money ---- */}
        <div className="ctc-section">
          <div className="ctc-section-head">
            <div className="ctc-h2"><Sparkles size={18} /> Extra money this month</div>
          </div>
          <div className="card">
            {availableAfterBills !== null && (
              <div className="ctc-hint" style={{ marginBottom: 12 }}>
                Based on your net take-home minus debt payments and fixed expenses, you have about{" "}
                <strong className="ctc-mono">{money(availableAfterBills)}</strong> left over most months before extras or savings.
              </div>
            )}
            <div className="field-row" style={{ alignItems: "end" }}>
              <div className="field">
                <label>Amount you have available</label>
                <input type="number" placeholder="e.g. 500" value={extraAmount} onChange={(e) => setExtraAmount(e.target.value)} />
              </div>
              <div className="field">
                <label>Ongoing strategy (for the timeline below)</label>
                <div className="strategy-pills">
                  <button className={`pill ${strategy === "tiered" ? "active" : ""}`} onClick={() => setStrategy("tiered")}>Your tiers</button>
                  <button className={`pill ${strategy === "snowball" ? "active" : ""}`} onClick={() => setStrategy("snowball")}>Snowball</button>
                  <button className={`pill ${strategy === "avalanche" ? "active" : ""}`} onClick={() => setStrategy("avalanche")}>Avalanche</button>
                </div>
              </div>
              <div className="field" style={{ flex: "0 0 auto" }}>
                <button className="btn btn-primary" onClick={runSuggestion}><TrendingDown size={15} /> Suggest allocation</button>
              </div>
            </div>
            <div className="ctc-hint" style={{ marginTop: 10 }}>
              The pills above set your ongoing strategy for the debt-free projection. "Suggest allocation" answers a different
              question — where this specific amount does the most good, three ways at once. Each bill's regular minimum
              payment is treated as already spoken for — only the amount left over after that minimum counts as needing
              extra dollars, and any partial payment carries forward to next month.
            </div>

            {suggestion && (
              <div className="suggestion-box">
                <div className="lens-grid">
                  <div className="lens-card">
                    <div className="lens-title">Frees the most monthly payment</div>
                    <div className="lens-metric">+{money(suggestion.cashFlow.freedMonthly)}/mo freed</div>
                    {suggestion.cashFlow.rows.map((r) => (
                      <div className="sugg-row ctc-mono" key={r.id}>
                        <span>{r.name}</span>
                        <span>+{money(r.applied)} {r.paidOff ? "→ paid off ✓" : `→ ${money(r.newBalance)} left, continues next month`}</span>
                      </div>
                    ))}
                    {suggestion.cashFlow.rows.length === 0 && <div className="ctc-hint">Not enough to fully clear any one bill.</div>}
                    <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => applySuggestionLens("cashFlow")}>Apply this</button>
                  </div>
                  <div className="lens-card">
                    <div className="lens-title">Cuts the most interest cost</div>
                    <div className="lens-metric">avalanche order</div>
                    {suggestion.interestCost.rows.map((r) => (
                      <div className="sugg-row ctc-mono" key={r.id}>
                        <span>{r.name}</span>
                        <span>+{money(r.applied)} {r.paidOff ? "→ paid off ✓" : `→ ${money(r.newBalance)} left, continues next month`}</span>
                      </div>
                    ))}
                    <div className="ctc-hint" style={{ marginTop: 6 }}>
                      {debts.some((d) => d.apr) ? "Ranked by the APRs you've entered." : "No APRs entered yet, so this matches your tiers for now — add interest rates for this to diverge."}
                    </div>
                    <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => applySuggestionLens("interestCost")}>Apply this</button>
                  </div>
                  <div className="lens-card">
                    <div className="lens-title">Gets you debt-free fastest</div>
                    <div className="lens-metric">
                      {suggestion.fastest.freedomMonth !== null ? monthLabelFull(suggestion.fastest.freedomMonth) : "480+ months out"}
                    </div>
                    {suggestion.fastest.rows.map((r) => (
                      <div className="sugg-row ctc-mono" key={r.id}>
                        <span>{r.name}</span>
                        <span>+{money(r.applied)} {r.paidOff ? "→ paid off ✓" : `→ ${money(r.newBalance)} left, continues next month`}</span>
                      </div>
                    ))}
                    <div className="ctc-hint" style={{ marginTop: 6 }}>Wins by simulating your recurring extra forward under {suggestion.fastest.strategyLabel}.</div>
                    <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => applySuggestionLens("fastest")}>Apply this</button>
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setSuggestion(null)}>Dismiss</button>
              </div>
            )}

            <div style={{ marginTop: 16, borderTop: "1px dashed var(--line)", paddingTop: 14 }}>
              <div className="field-row">
                <div className="field">
                  <label>Recurring extra, every month</label>
                  <input type="number" value={recurringExtra} onChange={(e) => setRecurringExtra(Number(e.target.value))} />
                </div>
              </div>
              <div className="ctc-hint" style={{ marginTop: 6 }}>This feeds the debt-free projection below automatically. Add one-off boosts (bonuses, tax refunds) in the timeline section.</div>
            </div>
          </div>
        </div>

        {/* ---- timeline ---- */}
        <div className="ctc-section">
          <div className="ctc-section-head">
            <div className="ctc-h2"><TrendingDown size={18} /> Payoff timeline</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setBoosts((b) => [...b, { id: nextId(), month: 3, amount: 1000 }])}><Plus size={13} /> Add one-time boost</button>
          </div>
          <div className="card">
            {boosts.length > 0 && (
              <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {boosts.map((b) => (
                  <div key={b.id} className="field-row" style={{ alignItems: "end" }}>
                    <div className="field">
                      <label>Months from now</label>
                      <input type="number" min="1" value={b.month} onChange={(e) => setBoosts((prev) => prev.map((x) => (x.id === b.id ? { ...x, month: Number(e.target.value) } : x)))} />
                    </div>
                    <div className="field">
                      <label>Amount</label>
                      <input type="number" value={b.amount} onChange={(e) => setBoosts((prev) => prev.map((x) => (x.id === b.id ? { ...x, amount: Number(e.target.value) } : x)))} />
                    </div>
                    <div className="field" style={{ flex: "0 0 auto" }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setBoosts((prev) => prev.filter((x) => x.id !== b.id))}><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#DED5BA" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} stroke="#5B6570" />
                  <YAxis tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} stroke="#5B6570" tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v) => money(v)} contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 12, borderRadius: 4, border: "1px solid #CFC6AE" }} />
                  {sim.freedomMonth !== null && <ReferenceLine x={monthLabel(sim.freedomMonth)} stroke="#3C6E47" strokeDasharray="4 4" label={{ value: "Debt-free", fontSize: 11, fill: "#2C5236" }} />}
                  <Line type="monotone" dataKey="total" stroke="#A5473A" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* ---- paycheck plan ---- */}
        <div className="ctc-section">
          <div className="ctc-section-head">
            <div className="ctc-h2"><Calendar size={18} /> Paycheck plan</div>
            <button className="btn btn-ghost btn-sm" onClick={addIncomeSource}><Plus size={13} /> Add paycheck source</button>
          </div>
          <div className="card">
            <div className="ctc-hint" style={{ marginBottom: 12 }}>
              Enter each paycheck below and pick its next pay date — everything after that is calculated automatically every
              two weeks. Bills are assigned to whichever paycheck falls in their billing window, factoring in each bill's
              grace period. A bill too big for one check gets split across the checks that cover it.
            </div>
            {incomeSources.map((src) => (
              <div className="field-row" key={src.id} style={{ alignItems: "end", marginBottom: 10 }}>
                <div className="field">
                  <label>Name</label>
                  <input value={src.name} onChange={(e) => updateIncomeSource(src.id, { name: e.target.value })} style={{ fontFamily: "Inter" }} />
                </div>
                <div className="field">
                  <label>Amount per check</label>
                  <input type="number" placeholder="e.g. 2100" value={src.amount} onChange={(e) => updateIncomeSource(src.id, { amount: e.target.value })} />
                </div>
                <div className="field">
                  <label>Next pay date</label>
                  <input type="date" value={src.nextPayDate} onChange={(e) => updateIncomeSource(src.id, { nextPayDate: e.target.value })} style={{ fontFamily: "Inter" }} />
                </div>
                <div className="field">
                  <label>Frequency</label>
                  <select value={src.frequency} onChange={(e) => updateIncomeSource(src.id, { frequency: e.target.value })}>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every 2 weeks</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="field" style={{ flex: "0 0 auto" }}>
                  <button className="btn-ghost btn-sm" style={{ border: "none" }} onClick={() => removeIncomeSource(src.id)}><Trash2 size={14} color="#A5473A" /></button>
                </div>
              </div>
            ))}

            {paycheckPlan.noIncome ? (
              <div className="ctc-hint" style={{ marginTop: 8 }}>Add an amount and a next pay date above to see your plan.</div>
            ) : (
              <>
                {paycheckPlan.shortfalls.length > 0 && (
                  <div className="warning-box">
                    <strong>Heads up:</strong> {paycheckPlan.shortfalls.length} bill{paycheckPlan.shortfalls.length > 1 ? "s" : ""} in
                    this window may not be fully covered by income before it's due — {paycheckPlan.shortfalls.map((s) => s.name).join(", ")}.
                  </div>
                )}
                {paycheckPlan.lateButInGrace.length > 0 && (
                  <div className="protected-note" style={{ marginBottom: 14 }}>
                    <strong>Paid within grace, not by the due date:</strong>{" "}
                    {paycheckPlan.lateButInGrace.map((l) => `${l.name} (${l.daysLate}d late)`).join(", ")}.
                  </div>
                )}
                <div className="paycheck-row">
                  {paycheckPlan.paychecks.slice(0, 8).map((p) => (
                    <div className="paycheck-card" key={p.id}>
                      <div className="paycheck-date">{fmtDate(p.date)}</div>
                      <div className="paycheck-source">
                        {p.sources.length > 1
                          ? p.sources.map((s) => `${s.sourceName} ${money(s.amount)}`).join(" + ") + ` = ${money(p.amount)}`
                          : `${p.sourceName} · ${money(p.amount)}`}
                      </div>
                      <div className="paycheck-items">
                        {p.items.length === 0 && <div className="ctc-hint">No bills assigned this check.</div>}
                        {p.items.map((it, idx) => (
                          <div className="paycheck-item" key={`${it.billId}-${idx}`}>
                            <span>{it.name}{it.split ? <span className="split-badge">{it.splitLabel}</span> : null}</span>
                            <span className="ctc-mono">{money(it.amount)}</span>
                          </div>
                        ))}
                      </div>
                      <div className={`paycheck-leftover ${p.remaining < 0 ? "brick" : "pine"}`}>
                        {p.remaining < 0 ? "Short " : "Left over "}
                        <span className="ctc-mono">{money(Math.abs(p.remaining))}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {paycheckPlan.unscheduled.length > 0 && (
                  <div className="protected-note" style={{ marginTop: 14 }}>
                    Not shown above (no due date set yet): {paycheckPlan.unscheduled.map((b) => b.name).join(", ")}. Add a due day
                    to each in the ledgers below to include them here.
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ---- debts ledger ---- */}
        <div className="ctc-section">
          <div className="ctc-section-head">
            <div className="ctc-h2"><PiggyBank size={18} /> Debts</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddDebt(true)}><Plus size={13} /> Add debt</button>
          </div>

          {tierGroups.map(({ tier, items }) => {
            const collapsed = collapsedTiers[tier];
            const balSum = items.reduce((s, d) => s + Number(d.balance || 0), 0);
            const monSum = items.reduce((s, d) => s + Number(d.monthly || 0), 0);
            if (items.length === 0) return null;
            return (
              <div key={tier} className="card" style={{ marginBottom: 12 }}>
                <div className="tier-head" onClick={() => setCollapsedTiers((p) => ({ ...p, [tier]: !p[tier] }))}>
                  <span className="tier-dot" style={{ background: TIERS[tier].color }} />
                  {TIERS[tier].label}
                  {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                  <span className="tier-sum">{money(monSum)}/mo · {money(balSum)} balance</span>
                </div>
                {!collapsed && (
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th style={{ width: "18%" }}>Name</th>
                        <th style={{ width: "14%" }}>Type</th>
                        <th>Monthly</th>
                        <th>Balance</th>
                        <th>APR %</th>
                        <th style={{ width: "10%" }}>Due day</th>
                        <th style={{ width: "8%" }} title="Days after due date before it's actually late">Grace</th>
                        <th style={{ width: "9%" }} title="Counts toward your debt-free projection">Goal</th>
                        <th style={{ width: "8%" }} title="OK to split across this month's paychecks with no real downside">Split OK</th>
                        <th style={{ width: 30 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((d) => (
                        <tr key={d.id}>
                          <td><input value={d.name} onChange={(e) => updateDebt(d.id, { name: e.target.value })} /></td>
                          <td>
                            <select value={d.type} onChange={(e) => updateDebt(d.id, { type: e.target.value })}>
                              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td><input type="number" value={d.monthly} onChange={(e) => updateDebt(d.id, { monthly: Number(e.target.value) })} /></td>
                          <td><input type="number" value={d.balance ?? ""} onChange={(e) => updateDebt(d.id, { balance: Number(e.target.value) })} /></td>
                          <td><input type="number" placeholder="—" value={d.apr ?? ""} onChange={(e) => updateDebt(d.id, { apr: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                          <td><input type="number" min="1" max="31" placeholder="—" value={d.dueDay ?? ""} onChange={(e) => updateDebt(d.id, { dueDay: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                          <td><input type="number" min="0" placeholder="0" value={d.graceDays ?? 0} onChange={(e) => updateDebt(d.id, { graceDays: e.target.value === "" ? 0 : Number(e.target.value) })} /></td>
                          <td style={{ textAlign: "center" }}>
                            <input type="checkbox" checked={!d.excludeFromGoal} onChange={(e) => updateDebt(d.id, { excludeFromGoal: !e.target.checked })} title="Include in the projected debt-free date" />
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <input type="checkbox" checked={!!d.splitFriendly} onChange={(e) => updateDebt(d.id, { splitFriendly: e.target.checked })} title="OK to split across this month's paychecks with no real downside" />
                          </td>
                          <td><button className="btn-ghost btn-sm" style={{ border: "none" }} onClick={() => removeDebt(d.id)}><Trash2 size={14} color="#A5473A" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}

          {protectedGroup.length > 0 && (
            <div className="card">
              <div className="tier-head" onClick={() => setCollapsedTiers((p) => ({ ...p, protected: !p.protected }))}>
                <span className="tier-dot" style={{ background: "#5B6570" }} />
                Minimum-only, forever <Lock size={13} />
                {collapsedTiers.protected ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                <span className="tier-sum">{money(protectedGroup.reduce((s, d) => s + Number(d.monthly || 0), 0))}/mo</span>
              </div>
              {!collapsedTiers.protected && (
                <>
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th style={{ width: "20%" }}>Name</th>
                        <th style={{ width: "14%" }}>Type</th>
                        <th>Monthly</th>
                        <th>Balance</th>
                        <th style={{ width: "10%" }}>Due day</th>
                        <th style={{ width: "8%" }}>Grace</th>
                        <th style={{ width: "9%" }} title="Counts toward your debt-free projection">Goal</th>
                        <th style={{ width: "8%" }} title="OK to split across this month's paychecks with no real downside">Split OK</th>
                        <th style={{ width: 30 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {protectedGroup.map((d) => (
                        <tr key={d.id}>
                          <td><input value={d.name} onChange={(e) => updateDebt(d.id, { name: e.target.value })} /></td>
                          <td>
                            <select value={d.type} onChange={(e) => updateDebt(d.id, { type: e.target.value })}>
                              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td><input type="number" value={d.monthly} onChange={(e) => updateDebt(d.id, { monthly: Number(e.target.value) })} /></td>
                          <td><input type="number" placeholder="unknown" value={d.balance ?? ""} onChange={(e) => updateDebt(d.id, { balance: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                          <td><input type="number" min="1" max="31" placeholder="—" value={d.dueDay ?? ""} onChange={(e) => updateDebt(d.id, { dueDay: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                          <td><input type="number" min="0" placeholder="0" value={d.graceDays ?? 0} onChange={(e) => updateDebt(d.id, { graceDays: e.target.value === "" ? 0 : Number(e.target.value) })} /></td>
                          <td style={{ textAlign: "center" }}>
                            <input type="checkbox" checked={!d.excludeFromGoal} onChange={(e) => updateDebt(d.id, { excludeFromGoal: !e.target.checked })} title="Include in the projected debt-free date" />
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <input type="checkbox" checked={!!d.splitFriendly} onChange={(e) => updateDebt(d.id, { splitFriendly: e.target.checked })} title="OK to split across this month's paychecks with no real downside" />
                          </td>
                          <td><button className="btn-ghost btn-sm" style={{ border: "none" }} onClick={() => removeDebt(d.id)}><Trash2 size={14} color="#A5473A" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="protected-note">These count toward your DTI and never get extra payments. Tick "Goal" if you want one counted toward your debt-free date — it needs a balance to be projectable. "Total debt-free" above only counts ones with a balance entered.</div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ---- fixed expenses ---- */}
        <div className="ctc-section">
          <div className="ctc-section-head">
            <div className="ctc-h2"><Home size={18} /> Fixed expenses</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddFixed(true)}><Plus size={13} /> Add expense</button>
          </div>
          <div className="card">
            <table className="ledger">
              <thead>
                <tr>
                  <th style={{ width: "18%" }}>Name</th>
                  <th style={{ width: "13%" }}>Type</th>
                  <th>Monthly</th>
                  <th style={{ width: "10%" }}>Due day</th>
                  <th style={{ width: "8%" }}>Grace</th>
                  <th style={{ width: "8%" }} title="OK to split across this month's paychecks with no real downside">Split OK</th>
                  <th>Note</th>
                  <th style={{ width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {fixed.map((f) => (
                  <tr key={f.id}>
                    <td><input value={f.name} onChange={(e) => updateFixed(f.id, { name: e.target.value })} /></td>
                    <td>
                      <select value={f.type} onChange={(e) => updateFixed(f.id, { type: e.target.value })}>
                        {FIXED_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td><input type="number" value={f.monthly} onChange={(e) => updateFixed(f.id, { monthly: Number(e.target.value) })} /></td>
                    <td><input type="number" min="1" max="31" placeholder="—" value={f.dueDay ?? ""} onChange={(e) => updateFixed(f.id, { dueDay: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                    <td><input type="number" min="0" placeholder="0" value={f.graceDays ?? 0} onChange={(e) => updateFixed(f.id, { graceDays: e.target.value === "" ? 0 : Number(e.target.value) })} /></td>
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={!!f.splitFriendly} onChange={(e) => updateFixed(f.id, { splitFriendly: e.target.checked })} title="OK to split across this month's paychecks with no real downside" />
                    </td>
                    <td><input value={f.note} placeholder="—" onChange={(e) => updateFixed(f.id, { note: e.target.value })} /></td>
                    <td><button className="btn-ghost btn-sm" style={{ border: "none" }} onClick={() => removeFixed(f.id)}><Trash2 size={14} color="#A5473A" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="footnote">
          Balances shown as "—" haven't been entered yet. Interest accrues monthly only where you've set an APR — otherwise
          minimum payments are treated as pure principal reduction. DTI reference bands (36% / 43%) are common general
          guidelines, not a specific lender's requirement — actual qualifying DTI varies by loan program and lender. This
          tool isn't financial or lending advice. Your data is saved to your account automatically as you go, and only visible when you're signed in.
        </div>
        </>
        )}

        {page === "monthly" && (
          <MonthlyPlan
            debtBills={debtBills}
            fixed={fixed}
            paidByMonth={paidByMonth}
            setPaidByMonth={setPaidByMonth}
          />
        )}
      </div>

      {showAddDebt && <AddDebtModal onClose={() => setShowAddDebt(false)} onAdd={addDebt} />}
      {showAddFixed && <AddFixedModal onClose={() => setShowAddFixed(false)} onAdd={addFixed} />}
    </div>
  );
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function MonthlyPlan({ debtBills, fixed, paidByMonth, setPaidByMonth }) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const monthKey = monthKeyOf(viewDate);
  const monthEntry = paidByMonth[monthKey] || {};

  const items = [
    ...debtBills.map((d) => ({ id: d.id, name: d.name, monthly: d.monthly, dueDay: d.dueDay })),
    ...fixed.map((f) => ({ id: f.id, name: f.name, monthly: f.monthly, dueDay: f.dueDay })),
  ].sort((a, b) => {
    if (a.dueDay == null && b.dueDay == null) return a.name.localeCompare(b.name);
    if (a.dueDay == null) return 1;
    if (b.dueDay == null) return -1;
    return a.dueDay - b.dueDay;
  });

  const totalMonthly = items.reduce((s, it) => s + Number(it.monthly || 0), 0);
  const paidTotal = items.reduce((s, it) => {
    const rec = getPaymentRecord(monthEntry, it);
    return s + Math.min(rec.amountPaid, Number(it.monthly || 0));
  }, 0);
  const remaining = totalMonthly - paidTotal;
  const progressPct = totalMonthly > 0 ? (paidTotal / totalMonthly) * 100 : 0;
  const fullyPaidCount = items.filter((it) => {
    const rec = getPaymentRecord(monthEntry, it);
    return Number(it.monthly || 0) > 0 && rec.amountPaid >= Number(it.monthly || 0);
  }).length;

  function updateRecord(item, patch) {
    setPaidByMonth((prev) => {
      const entry = prev[monthKey] || {};
      const current = getPaymentRecord(entry, item);
      const next = { ...current, ...patch };
      // Auto-stamp today's date the moment a payment first shows up, so the
      // paycheck plan knows which check it actually came from without extra
      // clicks — still editable afterward for backdating.
      if (patch.amountPaid !== undefined && patch.paidDate === undefined) {
        next.paidDate = patch.amountPaid > 0 ? (current.paidDate || isoDate(new Date())) : null;
      }
      return { ...prev, [monthKey]: { ...entry, [item.id]: next } };
    });
  }

  function toggleFullyPaid(item) {
    const rec = getPaymentRecord(monthEntry, item);
    const monthly = Number(item.monthly || 0);
    updateRecord(item, { amountPaid: rec.amountPaid >= monthly ? 0 : monthly });
  }

  function shiftMonth(delta) {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  }

  const monthLabelText = viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const isCurrentMonth = monthKeyOf(new Date()) === monthKey;

  return (
    <div style={{ marginTop: 4 }}>
      <div className="ctc-section-head" style={{ marginTop: 18 }}>
        <div className="ctc-h2"><Calendar size={18} /> Monthly plan</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="btn-ghost btn-sm" style={{ border: "1px solid var(--line)" }} onClick={() => shiftMonth(-1)}><ChevronLeft size={15} /></button>
          <span className="ctc-mono" style={{ minWidth: 130, textAlign: "center", fontWeight: 600 }}>{monthLabelText}</span>
          <button className="btn-ghost btn-sm" style={{ border: "1px solid var(--line)" }} onClick={() => shiftMonth(1)}><ChevronRight size={15} /></button>
          {!isCurrentMonth && (
            <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(new Date())}>Today</button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="wall-head" style={{ marginBottom: 8 }}>
          <span className="wall-title">{fullyPaidCount} of {items.length} fully paid</span>
          <span className="wall-meta ctc-mono">{money(remaining)} remaining of {money(totalMonthly)}</span>
        </div>
        <div className="wall-track">
          <div className="wall-seg" style={{ width: `${progressPct}%`, background: "var(--pine)" }} />
        </div>
      </div>

      {items.length === 0 && (
        <div className="card"><div className="ctc-hint">No debts or fixed expenses yet — add some from the Dashboard tab.</div></div>
      )}

      {items.map((it) => {
        const monthly = Number(it.monthly || 0);
        const rec = getPaymentRecord(monthEntry, it);
        const fullyPaid = monthly > 0 && rec.amountPaid >= monthly;
        const partial = rec.amountPaid > 0 && !fullyPaid;
        const billRemaining = Math.max(0, monthly - rec.amountPaid);

        let icon;
        if (fullyPaid) icon = <CheckCircle2 size={20} color="var(--pine-deep)" />;
        else if (partial) icon = <Circle size={20} color="var(--brass-deep)" fill="var(--brass-deep)" fillOpacity={0.25} />;
        else icon = <Circle size={20} color="var(--line)" />;

        return (
          <div key={it.id} className="card" style={{ marginBottom: 8, opacity: fullyPaid ? 0.7 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                className="btn-ghost btn-sm"
                style={{ border: "none", padding: 0 }}
                onClick={() => toggleFullyPaid(it)}
                title={fullyPaid ? "Mark unpaid" : "Mark fully paid"}
              >
                {icon}
              </button>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, textDecoration: fullyPaid ? "line-through" : "none" }}>{it.name}</div>
                {it.dueDay != null && <div className="ctc-hint">Due the {ordinal(it.dueDay)}</div>}
                {partial && <div className="ctc-hint" style={{ color: "var(--brass-deep)", fontWeight: 600 }}>Partial — {money(billRemaining)} remaining</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                <input
                  type="number"
                  className="ctc-mono"
                  value={rec.amountPaid || ""}
                  placeholder="0"
                  onChange={(e) => updateRecord(it, { amountPaid: e.target.value === "" ? 0 : Number(e.target.value) })}
                  style={{ width: 90, textAlign: "right", border: "1px solid var(--line)", borderRadius: 3, padding: "4px 6px", fontSize: 13 }}
                />
                <div className="ctc-hint" style={{ marginTop: 2 }}>of {money(monthly)}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line)", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-soft)" }}>
                <input type="checkbox" checked={rec.cleared} onChange={(e) => updateRecord(it, { cleared: e.target.checked })} />
                Cleared the bank
              </label>
              <input
                value={rec.bank}
                onChange={(e) => updateRecord(it, { bank: e.target.value })}
                placeholder="Which bank/account"
                style={{ flex: 1, minWidth: 120, border: "1px solid var(--line)", borderRadius: 3, padding: "5px 8px", fontSize: 12.5, fontFamily: "Inter, sans-serif" }}
              />
              {rec.amountPaid > 0 && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-soft)" }}>
                  Paid on
                  <input
                    type="date"
                    value={rec.paidDate || ""}
                    onChange={(e) => updateRecord(it, { paidDate: e.target.value || null })}
                    style={{ border: "1px solid var(--line)", borderRadius: 3, padding: "4px 6px", fontSize: 12.5, fontFamily: "Inter, sans-serif" }}
                  />
                </label>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}