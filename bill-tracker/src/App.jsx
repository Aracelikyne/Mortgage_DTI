import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import AppShell from "./components/AppShell";
import { repairDuplicateIds } from "./utils/ids";
import { persistIdRepair, rememberIdRepair } from "./lib/idRepair";
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

// GitHub OAuth via Supabase populates user_metadata with whatever GitHub
// exposes — prefer their display name, fall back to their GitHub handle,
// then email, so there's always something to attribute an edit to.
function displayNameFor(user) {
  const meta = user?.user_metadata || {};
  return meta.full_name || meta.name || meta.user_name || user?.email || "Someone";
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking, null = signed out
  const [saved, setSaved] = useState(null); // null until the row has been fetched
  const [initialLastEditedBy, setInitialLastEditedBy] = useState({ name: null, at: null });
  const [loadError, setLoadError] = useState(null);
  // An id repair that couldn't be written at load (its backup failed) —
  // handed to AppShell so its next save retries it, backup first.
  const [pendingIdRepair, setPendingIdRepair] = useState(null);

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
      .from("household_state")
      .select("data, updated_at, updated_by_name")
      .eq("id", "household")
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error(error);
          setLoadError("Couldn't reach the shared data in Supabase — starting blank, and edits may not save until this is fixed. Check the browser console for details (the household_state table may be missing — see supabase/shared_data_migration.sql).");
          setSaved({});
          return;
        }

        if (data?.data) {
          // Older sessions handed out the same ids over and over (see
          // utils/ids.js) — unlink any records still sharing one before
          // anything gets a chance to edit them as a pair.
          const { data: repaired, report } = repairDuplicateIds(data.data);
          if (report.changed) {
            const userName = displayNameFor(session.user);
            const result = await persistIdRepair({ original: data.data, repaired, report, userId: session.user.id, userName });
            rememberIdRepair(report, result); // even if this run was superseded — the repair itself still happened
            if (cancelled) return;
            if (result.ok && !result.handledElsewhere) {
              setInitialLastEditedBy({ name: userName, at: result.savedAt });
            } else if (result.ok) {
              setInitialLastEditedBy({ name: data.updated_by_name, at: data.updated_at });
            } else {
              console.error(result.error);
              setPendingIdRepair({ original: data.data, repaired, report });
              setInitialLastEditedBy({ name: data.updated_by_name, at: data.updated_at });
            }
            setSaved(repaired);
            return;
          }
          setSaved(data.data);
          setInitialLastEditedBy({ name: data.updated_by_name, at: data.updated_at });
          return;
        }

        // No shared row yet — seed it once from whichever legacy source has
        // data: this user's old private per-user row, or (older still) this
        // browser's localStorage — so nothing has to be re-entered.
        const { data: legacyRow } = await supabase
          .from("app_state")
          .select("data")
          .eq("user_id", session.user.id)
          .maybeSingle();
        const legacy = legacyRow?.data || readLegacyLocalState();
        if (legacy && Object.keys(legacy).length > 0) {
          // Legacy data came from the same id counter, so it gets the same
          // repair — with the untouched legacy blob backed up first.
          const { data: repaired, report } = repairDuplicateIds(legacy);
          let upsertError;
          if (report.changed) {
            const result = await persistIdRepair({ original: legacy, repaired, report, userId: session.user.id, userName: displayNameFor(session.user) });
            rememberIdRepair(report, result);
            if (cancelled) return;
            upsertError = result.ok ? null : result.error;
          } else {
            ({ error: upsertError } = await supabase.from("household_state").upsert({
              id: "household",
              data: legacy,
              updated_at: new Date().toISOString(),
              updated_by_id: session.user.id,
              updated_by_name: displayNameFor(session.user),
            }));
          }
          if (cancelled) return;
          if (upsertError) {
            console.error(upsertError);
            setLoadError("Couldn't save the imported data to Supabase — the household_state table may be missing (see supabase/shared_data_migration.sql). Your edits from here may not save either.");
            if (report.changed) setPendingIdRepair({ original: legacy, repaired, report });
          }
          setSaved(repaired);
          setInitialLastEditedBy({ name: displayNameFor(session.user), at: new Date().toISOString() });
          return;
        }

        setSaved({});
      });
    return () => { cancelled = true; };
  }, [session]);

  if (session === undefined || (session && saved === null)) {
    return <AuthScreen loading />;
  }
  if (!session) {
    return <AuthScreen />;
  }
  return (
    <AppShell
      key={session.user.id}
      saved={saved}
      userId={session.user.id}
      userName={displayNameFor(session.user)}
      initialLastEditedBy={initialLastEditedBy}
      initialPendingIdRepair={pendingIdRepair}
      loadError={loadError}
    />
  );
}

function AuthScreen({ loading }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <img className="auth-icon" src={`${import.meta.env.BASE_URL}apple-touch-icon.png`} alt="" width="76" height="76" />
        <h1 className="auth-title">Clear to Close</h1>
        {loading ? (
          <p className="auth-sub" role="status">Loading…</p>
        ) : (
          <>
            <p className="auth-sub">Your household's debt payoff and DTI tracker. Sign in to see and edit your data.</p>
            <button
              type="button"
              className="btn btn-filled btn-block btn-large"
              onClick={() =>
                supabase.auth.signInWithOAuth({
                  provider: "github",
                  options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
                })
              }
            >
              <LogIn size={19} aria-hidden="true" /> Sign in with GitHub
            </button>
          </>
        )}
      </div>
    </div>
  );
}
