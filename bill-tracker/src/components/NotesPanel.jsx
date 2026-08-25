import { useEffect, useState } from "react";
import { NotebookPen, X, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

function relativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// A shared scratchpad notebook that slides in from the side. Notes live in
// their own Supabase table (not the household_state blob), so they're
// permanent — they outlive a sign-out or an expired session — and every
// note is stamped with whoever wrote it. Always mounted (not just while
// open) so its realtime subscription keeps the unread-style badge current
// even while the panel itself is closed.
export default function NotesPanel({ userId, userName }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("notes")
      .select("id, user_id, user_name, content, created_at")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error(error);
          setLoadError("Couldn't load notes — the notes table may be missing (see supabase/notes_migration.sql).");
          return;
        }
        setNotes(data || []);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("notes_changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notes" }, (payload) => {
        setNotes((prev) => (prev.some((n) => n.id === payload.new.id) ? prev : [payload.new, ...prev]));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "notes" }, (payload) => {
        setNotes((prev) => prev.filter((n) => n.id !== payload.old.id));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  function submit() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    supabase
      .from("notes")
      .insert({ user_id: userId, user_name: userName, content })
      .select()
      .single()
      .then(({ data, error }) => {
        if (error) { console.error(error); return; }
        setNotes((prev) => (prev.some((n) => n.id === data.id) ? prev : [data, ...prev]));
      });
  }

  function removeNote(id) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    supabase.from("notes").delete().eq("id", id).then(({ error }) => { if (error) console.error(error); });
  }

  return (
    <>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen((o) => !o)}
        title="Shared notebook"
      >
        <NotebookPen size={14} /> Notes{notes.length > 0 ? ` (${notes.length})` : ""}
      </button>

      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 320,
          background: "var(--paper)", borderLeft: "1px solid var(--line)",
          boxShadow: open ? "-4px 0 16px rgba(0,0,0,0.12)" : "none",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.2s ease", zIndex: 100,
          display: "flex", flexDirection: "column", fontFamily: "Inter, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <div className="ctc-h2" style={{ margin: 0 }}><NotebookPen size={16} /> Shared notes</div>
          <button className="btn-ghost btn-sm" style={{ border: "none" }} onClick={() => setOpen(false)}><X size={16} /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {loadError && <div className="ctc-hint" style={{ color: "var(--brick)" }}>{loadError}</div>}
          {!loadError && notes.length === 0 && <div className="ctc-hint">No notes yet — jot something down below.</div>}
          {notes.map((n) => (
            <div key={n.id} className="card" style={{ padding: 10 }}>
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{n.content}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                <span className="ctc-hint" style={{ fontSize: 11 }}>{n.user_name} · {relativeTime(n.created_at)}</span>
                <button className="btn-ghost btn-sm" style={{ border: "none", padding: 2 }} title="Delete note" onClick={() => removeNote(n.id)}>
                  <Trash2 size={12} color="#A5473A" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: 12, borderTop: "1px solid var(--line)", display: "flex", gap: 6 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Add a note…"
            rows={2}
            style={{ flex: 1, resize: "none", border: "1px solid var(--line)", borderRadius: 4, padding: "6px 8px", fontFamily: "Inter, sans-serif", fontSize: 13 }}
          />
          <button className="btn btn-primary btn-sm" onClick={submit}>Add</button>
        </div>
      </div>
    </>
  );
}
