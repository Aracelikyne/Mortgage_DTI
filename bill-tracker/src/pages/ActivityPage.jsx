import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import { ListSection } from "../components/ui/List";
import { supabase } from "../lib/supabaseClient";
import { relativeTime } from "../utils/time";
import { useHouseholdContext } from "../state/HouseholdContext";

// A feed of who did what, most recent first — the "who made what edits"
// record that the shared household row alone can't show (that row only
// ever has the very latest name attached to it, not a history).
export default function ActivityPage() {
  const { remoteChangePending } = useHouseholdContext();
  const [entries, setEntries] = useState(null); // null = loading
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("activity_log")
      .select("id, user_name, action, created_at")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error(error);
          setLoadError("Couldn't load activity — the activity_log table may be missing (see supabase/shared_data_migration.sql).");
          setEntries([]);
          return;
        }
        setEntries(data || []);
      });
    return () => { cancelled = true; };
  }, [remoteChangePending]);

  return (
    <>
      <PageHeader title="Activity" />
      <div className="page-content">
        {loadError && <p className="inline-warning">{loadError}</p>}
        <ListSection footer="The last 100 changes, newest first.">
          {entries === null && !loadError && <div className="row muted">Loading…</div>}
          {entries && entries.length === 0 && !loadError && <div className="row muted">No edits logged yet.</div>}
          {(entries || []).map((e) => (
            <div key={e.id} className="row activity-row">
              <span className="row-body">
                <span className="row-title"><strong>{e.user_name}</strong> {e.action}</span>
              </span>
              <span className="row-detail small">{relativeTime(e.created_at)}</span>
            </div>
          ))}
        </ListSection>
      </div>
    </>
  );
}
