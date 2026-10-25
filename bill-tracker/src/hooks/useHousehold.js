import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { initialDebts, initialFixed } from "../data/constants";
import { newId, repairDuplicateIds } from "../utils/ids";
import { sameData } from "../utils/sameData";
import { describeChanges } from "../utils/activity";
import { persistIdRepair, rememberIdRepair, readIdRepairNotice, dismissIdRepairNotice } from "../lib/idRepair";

// The shared household row: every piece of it as React state, plus
// everything that keeps it in sync — the debounced save, absorbing the
// other person's saves over realtime, sandbox mode, and the duplicate-id
// repair. `spectating` (following someone live) makes this read-only.
export function useHousehold({ saved, userId, userName, initialLastEditedBy, initialPendingIdRepair, spectating }) {
  const [debts, setDebts] = useState(saved.debts || initialDebts);
  const [paidOffDebts, setPaidOffDebts] = useState(saved.paidOffDebts || []);
  const [fixed, setFixed] = useState(saved.fixed || initialFixed);
  const [income, setIncome] = useState(saved.income ?? 15000);
  const [netIncome, setNetIncome] = useState(saved.netIncome ?? "");
  const [includeRent, setIncludeRent] = useState(saved.includeRent ?? false);
  const [recurringExtra, setRecurringExtra] = useState(saved.recurringExtra ?? 0);
  const [strategy, setStrategy] = useState(saved.strategy || "tiered");
  const [targetDTI, setTargetDTI] = useState(saved.targetDTI ?? 43);
  const [mortgageEstimate, setMortgageEstimate] = useState(saved.mortgageEstimate ?? 3000);
  const [incomeSources, setIncomeSources] = useState(() => saved.incomeSources || [
    { id: newId(), name: "Your paycheck", amount: "", nextPayDate: "", frequency: "biweekly" },
    { id: newId(), name: "Partner's paycheck", amount: "", nextPayDate: "", frequency: "biweekly" },
  ]);
  const [boosts, setBoosts] = useState(saved.boosts || []);
  const [paycheckReserve, setPaycheckReserve] = useState(saved.paycheckReserve ?? 500);
  const [paidByMonth, setPaidByMonth] = useState(saved.paidByMonth || {});
  const [debtBaseline, setDebtBaseline] = useState(saved.debtBaseline ?? null);
  const [paycheckOverrides, setPaycheckOverrides] = useState(saved.paycheckOverrides || {});

  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const saveTimer = useRef(null);
  const [lastEditedBy, setLastEditedBy] = useState(initialLastEditedBy || { name: null, at: null });
  const [remoteChangePending, setRemoteChangePending] = useState(false);

  const spectatingRef = useRef(false);
  useEffect(() => { spectatingRef.current = spectating; }, [spectating]);

  // Sandbox mode: a play-with-the-numbers detour that never touches the
  // shared row. Entering it doesn't need to snapshot anything locally —
  // Supabase already holds the last real, saved state the whole time
  // sandboxing is on (since saving is suppressed below), so exiting just
  // re-syncs from there, cleanly discarding whatever was tried.
  const [sandboxActive, setSandboxActive] = useState(false);
  const sandboxActiveRef = useRef(false);
  useEffect(() => { sandboxActiveRef.current = sandboxActive; }, [sandboxActive]);

  // What's actually been saved to the shared row so far — the diff base for
  // describing what a save changed, and the target applyLoadedState below
  // keeps in sync whenever a remote update is absorbed without a save.
  // Starts at the data this session loaded with, not an empty object, so
  // the very first save (if anything changed before this component even
  // mounted, e.g. an autopay auto-settling on load) doesn't get misread as
  // "everything was just added."
  const lastSavedState = useRef(saved);

  // An id repair (see utils/ids.js) that still has to reach the shared row.
  // Every save waits on it, so repaired data is never written before the
  // untouched original has been backed up.
  const pendingIdRepair = useRef(initialPendingIdRepair || null);
  const idRepairInFlight = useRef(null);
  const [idRepairNotice, setIdRepairNotice] = useState(readIdRepairNotice);
  const runPendingIdRepair = useCallback(() => {
    if (idRepairInFlight.current) return idRepairInFlight.current;
    if (!pendingIdRepair.current) return Promise.resolve(true);
    // Loops so a newer repair queued while one is still being written (two
    // broken saves arriving back to back) goes out right after it.
    const drain = async () => {
      while (pendingIdRepair.current) {
        const job = pendingIdRepair.current;
        const result = await persistIdRepair({ ...job, userId, userName });
        setIdRepairNotice(rememberIdRepair(job.report, result));
        if (!result.ok) {
          console.error(result.error);
          return false;
        }
        if (pendingIdRepair.current === job) pendingIdRepair.current = null;
        if (!result.handledElsewhere) setLastEditedBy({ name: userName, at: result.savedAt });
      }
      return true;
    };
    idRepairInFlight.current = drain().finally(() => { idRepairInFlight.current = null; });
    return idRepairInFlight.current;
  }, [userId, userName]);

  const dismissIdRepair = useCallback(() => {
    dismissIdRepairNotice();
    setIdRepairNotice(null);
  }, []);

  // Replaces every piece of local state with a freshly loaded shared row —
  // used both to seed a follow session with the leader's current data, and
  // to silently absorb the other person's saves while nothing here is
  // pending, instead of making every load go through a full page refresh.
  // A device still running an older build can keep minting duplicate ids,
  // so whatever arrives gets the same repair the initial load does — and
  // the repair is written right away (it's the real shared data, never
  // sandbox numbers, so that's safe even mid-sandbox or while following).
  const applyLoadedState = useCallback((incoming) => {
    const { data, report } = repairDuplicateIds(incoming || {});
    setDebts(data.debts || initialDebts);
    setPaidOffDebts(data.paidOffDebts || []);
    setFixed(data.fixed || initialFixed);
    setIncome(data.income ?? 15000);
    setNetIncome(data.netIncome ?? "");
    setIncludeRent(data.includeRent ?? false);
    setRecurringExtra(data.recurringExtra ?? 0);
    setStrategy(data.strategy || "tiered");
    setTargetDTI(data.targetDTI ?? 43);
    setMortgageEstimate(data.mortgageEstimate ?? 3000);
    setIncomeSources(data.incomeSources || []);
    setBoosts(data.boosts || []);
    setPaycheckReserve(data.paycheckReserve ?? 500);
    setPaidByMonth(data.paidByMonth || {});
    setDebtBaseline(data.debtBaseline ?? null);
    setPaycheckOverrides(data.paycheckOverrides || {});
    lastSavedState.current = data;
    if (report.changed) {
      pendingIdRepair.current = { original: incoming, repaired: data, report };
      runPendingIdRepair();
    }
  }, [runPendingIdRepair]);

  const refetchHousehold = useCallback(async () => {
    const { data, error } = await supabase
      .from("household_state")
      .select("data, updated_at, updated_by_name")
      .eq("id", "household")
      .maybeSingle();
    if (!error && data?.data) {
      applyLoadedState(data.data);
      setLastEditedBy({ name: data.updated_by_name, at: data.updated_at });
    }
  }, [applyLoadedState]);

  const enterSandbox = useCallback(() => setSandboxActive(true), []);
  // Re-sync from the shared row before dropping the sandbox flag, so the
  // debounced save effect below still sees sandboxing as active for the
  // state changes this restore itself triggers — otherwise the discarded
  // sandbox numbers could get saved right back over real data.
  const exitSandbox = useCallback(async () => {
    await refetchHousehold();
    setRemoteChangePending(false); // the refetch above already caught up
    setSandboxActive(false);
  }, [refetchHousehold]);

  // ---- persistence ----
  const isFirstRender = useRef(true);
  const latestState = useRef(null);
  useEffect(() => {
    latestState.current = { debts, paidOffDebts, fixed, income, netIncome, includeRent, recurringExtra, strategy, targetDTI, mortgageEstimate, incomeSources, boosts, paycheckReserve, paidByMonth, debtBaseline, paycheckOverrides };
  });

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const nextState = latestState.current;
    if (sameData(nextState, lastSavedState.current)) {
      setSaveStatus((s) => (s === "saving" ? "saved" : s));
      return;
    }
    setSaveStatus("saving");
    if (pendingIdRepair.current && !(await runPendingIdRepair())) {
      setSaveStatus("error");
      return;
    }
    const changes = describeChanges(lastSavedState.current, nextState);
    const now = new Date().toISOString();
    supabase
      .from("household_state")
      .upsert({
        id: "household",
        data: nextState,
        updated_at: now,
        updated_by_id: userId,
        updated_by_name: userName,
      })
      .then(({ error }) => {
        setSaveStatus(error ? "error" : "saved");
        if (error) {
          console.error(error);
          return;
        }
        lastSavedState.current = nextState;
        setLastEditedBy({ name: userName, at: now });
        if (changes.length > 0) {
          supabase
            .from("activity_log")
            .insert(changes.map((action) => ({ user_id: userId, user_name: userName, action })))
            .then(({ error: logErr }) => { if (logErr) console.error(logErr); });
        }
      });
  }, [userId, userName, runPendingIdRepair]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // While spectating, local state only ever changes because a remote
    // update was just absorbed (applyLoadedState) — saving that straight
    // back would falsely attribute the other person's edit to this
    // account, so following is treated as read-only and skips the
    // debounced save entirely. Sandbox edits are never saved either — the
    // whole point is a detour that leaves the shared data untouched.
    if (spectatingRef.current || sandboxActiveRef.current) return;
    // Absorbing the other person's save (applyLoadedState) replaces every
    // piece of state at once without making it any different from what's
    // saved. Saving that straight back used to bounce one edit between two
    // open devices indefinitely — each echo re-triggering the other's save.
    if (sameData(latestState.current, lastSavedState.current)) {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      return;
    }
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 700);
    return () => clearTimeout(saveTimer.current);
  }, [debts, paidOffDebts, fixed, income, netIncome, includeRent, recurringExtra, strategy, targetDTI, mortgageEstimate, incomeSources, boosts, paycheckReserve, paidByMonth, debtBaseline, paycheckOverrides, flushSave]);

  // Since this data is now shared between two people, the other person can
  // save changes while this tab is open. If nothing here is mid-edit
  // (no pending debounced save), or this session is actively spectating
  // (read-only by design), it's safe to just absorb the update directly.
  // While sandboxing, the local numbers are deliberately diverged from the
  // real data, so a remote update is never auto-applied there either — it's
  // just flagged, and gets picked up naturally on the next sandbox exit
  // (which always re-syncs from the shared row anyway). Otherwise, rather
  // than risk silently overwriting a local edit, flag that newer data
  // exists and let the user choose when to reload for it.
  useEffect(() => {
    const channel = supabase
      .channel("household_state_changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "household_state", filter: "id=eq.household" },
        (payload) => {
          const row = payload.new;
          if (!row || row.updated_by_id === userId) return;
          setLastEditedBy({ name: row.updated_by_name, at: row.updated_at });
          if (spectatingRef.current || (!sandboxActiveRef.current && !saveTimer.current)) {
            applyLoadedState(row.data);
          } else {
            setRemoteChangePending(true);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, applyLoadedState]);

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

  return {
    // shared data
    debts, setDebts, paidOffDebts, setPaidOffDebts, fixed, setFixed,
    income, setIncome, netIncome, setNetIncome, includeRent, setIncludeRent,
    recurringExtra, setRecurringExtra, strategy, setStrategy, targetDTI, setTargetDTI,
    mortgageEstimate, setMortgageEstimate, incomeSources, setIncomeSources, boosts, setBoosts,
    paycheckReserve, setPaycheckReserve, paidByMonth, setPaidByMonth, debtBaseline, setDebtBaseline,
    paycheckOverrides, setPaycheckOverrides,
    // sync
    saveStatus, lastEditedBy, remoteChangePending, setRemoteChangePending, refetchHousehold,
    sandboxActive, enterSandbox, exitSandbox,
    idRepairNotice, dismissIdRepair,
  };
}
