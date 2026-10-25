import { supabase } from "./supabaseClient";
import { isoDate } from "../utils/finance";
import { describeIdRepair } from "../utils/ids";
import { sameData } from "../utils/sameData";

const BACKUP_PREFIX = "backup-before-id-repair-";
const NOTICE_KEY = "ctc-id-repair-notice";

// Writes a repairDuplicateIds() result to the shared row — but only after the
// untouched original has been saved to its own backup row in household_state
// (RLS already allows authenticated inserts). Backups are inserted, never
// upserted, so a second repair on the same day lands in "-2", "-3"… instead
// of overwriting the first one. If the backup can't be written, the repaired
// data isn't written either.
export async function persistIdRepair({ original, repaired, report, userId, userName }) {
  const savedAt = new Date().toISOString();
  const base = BACKUP_PREFIX + isoDate(new Date());
  let backupId = null;
  for (let n = 1; n <= 50 && !backupId; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    const { error } = await supabase.from("household_state").insert({
      id, data: original, updated_at: savedAt, updated_by_id: userId, updated_by_name: userName,
    });
    if (!error) {
      backupId = id;
      break;
    }
    if (error.code !== "23505") return { ok: false, error }; // anything but "that id's taken"
    // Taken. If it already holds this exact original, the other device (or
    // another tab) got the same broken data at the same moment and is
    // repairing it — the repair is deterministic, so let that one finish
    // rather than writing a second backup and a second set of log lines.
    const { data: existing } = await supabase.from("household_state").select("data").eq("id", id).maybeSingle();
    if (existing && sameData(existing.data, original)) return { ok: true, backupId: id, savedAt, handledElsewhere: true };
  }
  if (!backupId) return { ok: false, error: new Error("No free backup row id") };

  const { error: upsertError } = await supabase.from("household_state").upsert({
    id: "household", data: repaired, updated_at: savedAt, updated_by_id: userId, updated_by_name: userName,
  });
  if (upsertError) return { ok: false, backupId, error: upsertError };

  const lines = [`Repaired duplicate IDs — the original data is backed up in household_state as "${backupId}"`, ...describeIdRepair(report)];
  const { error: logError } = await supabase
    .from("activity_log")
    .insert(lines.map((action) => ({ user_id: userId, user_name: userName, action })));
  if (logError) console.error(logError);

  return { ok: true, backupId, savedAt };
}

// The banner listing what got unlinked stays up (on this device) until it's
// dismissed — a reload before reading it shouldn't lose it, since the
// repair itself only ever happens once.
export function rememberIdRepair(report, result) {
  const notice = {
    at: new Date().toISOString(),
    groups: report.groups,
    backupId: result.backupId || null,
    saved: !!result.ok,
  };
  try { localStorage.setItem(NOTICE_KEY, JSON.stringify(notice)); } catch { /* best effort */ }
  return notice;
}

export function readIdRepairNotice() {
  try {
    const notice = JSON.parse(localStorage.getItem(NOTICE_KEY) || "null");
    return notice && Array.isArray(notice.groups) ? notice : null;
  } catch {
    return null;
  }
}

export function dismissIdRepairNotice() {
  try { localStorage.removeItem(NOTICE_KEY); } catch { /* best effort */ }
}
