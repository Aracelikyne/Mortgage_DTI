import { useState } from "react";
import { ArrowUp, Trash2 } from "lucide-react";
import Sheet from "./ui/Sheet";
import { relativeTime } from "../utils/time";

// The shared notebook (data and realtime live in useNotes, always mounted).
export default function NotesSheet({ notes, loadError, onAdd, onRemove, onClose }) {
  const [draft, setDraft] = useState("");

  function submit() {
    if (!draft.trim()) return;
    onAdd(draft);
    setDraft("");
  }

  return (
    <Sheet title="Shared Notes" onClose={onClose} className="notes-sheet">
      <div className="notes-compose">
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
          aria-label="New note"
        />
        <button type="button" className="send-btn" onClick={submit} disabled={!draft.trim()} aria-label="Add note"><ArrowUp size={20} /></button>
      </div>
      {loadError && <p className="inline-warning">{loadError}</p>}
      {!loadError && notes.length === 0 && <p className="muted center">No notes yet — jot something down above.</p>}
      <div className="notes-list">
        {notes.map((n) => (
          <div key={n.id} className="note">
            <div className="note-content">{n.content}</div>
            <div className="note-meta">
              <span>{n.user_name} · {relativeTime(n.created_at)}</span>
              <button type="button" className="icon-btn destructive" title="Delete note" aria-label="Delete note" onClick={() => onRemove(n.id)}><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
