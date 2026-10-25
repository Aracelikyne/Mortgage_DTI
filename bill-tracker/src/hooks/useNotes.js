import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// The shared scratchpad notebook. Notes live in their own Supabase table
// (not the household_state blob), so they're permanent — they outlive a
// sign-out or an expired session — and every note is stamped with whoever
// wrote it. Used from AppShell, which is always mounted, so the realtime
// subscription keeps the count current even while the notes sheet is closed.
export function useNotes({ userId, userName }) {
  const [notes, setNotes] = useState([]);
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

  const addNote = useCallback((text) => {
    const content = text.trim();
    if (!content) return;
    supabase
      .from("notes")
      .insert({ user_id: userId, user_name: userName, content })
      .select()
      .single()
      .then(({ data, error }) => {
        if (error) { console.error(error); return; }
        setNotes((prev) => (prev.some((n) => n.id === data.id) ? prev : [data, ...prev]));
      });
  }, [userId, userName]);

  const removeNote = useCallback((id) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    supabase.from("notes").delete().eq("id", id).then(({ error }) => { if (error) console.error(error); });
  }, []);

  return { notes, loadError, addNote, removeNote };
}
