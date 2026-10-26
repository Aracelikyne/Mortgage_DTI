import { useMemo, useState } from "react";
import { CheckCircle2, Circle, FileSpreadsheet } from "lucide-react";
import Sheet from "./ui/Sheet";
import Banner from "./ui/Banner";
import SegmentedControl from "./ui/SegmentedControl";
import { ListRow, ListSection, SelectField, SwitchRow } from "./ui/List";
import { readSpreadsheetFile, spreadsheetAccept, SPREADSHEET_EXTENSIONS } from "../lib/spreadsheet";
import { supabase } from "../lib/supabaseClient";
import { isoDate, money } from "../utils/finance";
import { buildStatementPlan } from "../utils/statementSync";
import { ordinal } from "../utils/format";
import {
  IMPORT_TARGETS, autoMapColumns, buildPreview, columnLabels, detectHeaderRow, markDuplicateExpenses,
  newDebtFrom, newFixedFrom, parseDelimited, patchFrom,
} from "../utils/importParse";
import { useHouseholdContext } from "../state/HouseholdContext";

const TARGET_OPTIONS = [
  { value: "statement", label: "Statement" },
  { value: "debts", label: "Debts" },
  { value: "fixed", label: "Fixed" },
  { value: "expenses", label: "Expenses" },
];
const EXPENSE_BATCH = 100;
const STATEMENT_BADGE = {
  update: ["Update", "badge-blue"],
  "new-debts": ["New debt", "badge-green"],
  "new-fixed": ["New fixed expense", "badge-green"],
  missing: ["Not on list", "badge-orange"],
  skip: ["Skipped", "badge-red"],
};

function describeValues(v, target) {
  if (target === "expenses") return [v.date, v.category].filter(Boolean).join(" · ");
  const parts = [];
  if (v.balance !== undefined && v.balance !== null) parts.push(`${money(v.balance)} balance`);
  if (v.monthly !== undefined && v.monthly !== null) parts.push(`${money(v.monthly)}/mo`);
  if (v.apr !== undefined && v.apr !== null) parts.push(`${v.apr}%`);
  if (v.dueDay) parts.push(`due the ${ordinal(v.dueDay)}`);
  if (v.type) parts.push(v.type);
  return parts.join(" · ");
}

function formatChange(c) {
  const show = (x) => (typeof x === "number" && ["monthly", "balance"].includes(c.key) ? money(x) : x ?? "—");
  return `${c.label} ${show(c.from)} → ${show(c.to)}`;
}

const MATCH_BADGE = {
  new: ["New", "badge-green"],
  update: ["Update", "badge-blue"],
  repeat: ["Already updated above", ""],
  ambiguous: ["Name matches several", "badge-orange"],
  duplicate: ["Looks already logged", "badge-orange"],
};

// Import from Apple Numbers (or Excel/CSV): pick a file or paste cells →
// choose the table → map columns and what to import into → review each row
// (matched to existing items by name: update or add new) → import.
export default function ImportSheet({ initialTarget = "debts", onClose }) {
  const h = useHouseholdContext();
  const [step, setStep] = useState("source"); // source | setup | preview | done
  const [sheets, setSheets] = useState([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [pasteText, setPasteText] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [headerAt, setHeaderAt] = useState(0);
  const [target, setTarget] = useState(initialTarget);
  const [mapping, setMapping] = useState({});
  const [selection, setSelection] = useState({});
  const [existingExpenses, setExistingExpenses] = useState(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  const rows = useMemo(() => sheets[sheetIndex]?.rows || [], [sheets, sheetIndex]);
  const headerRow = hasHeader ? headerAt : -1;
  const labels = columnLabels(rows, headerRow);
  const fields = IMPORT_TARGETS[target].fields;
  const { debts, fixed } = h;
  const existing = useMemo(() => (target === "debts" ? debts : target === "fixed" ? fixed : []), [target, debts, fixed]);

  const statementBy = h.userName;
  const preview = useMemo(() => {
    if (step !== "preview" && step !== "done") return [];
    if (target === "statement") return buildStatementPlan({ rows, headerRow, mapping, debts, fixed, asOf: isoDate(new Date()), by: statementBy });
    const built = buildPreview({ rows, headerRow, mapping, target, existing });
    return target === "expenses" && existingExpenses ? markDuplicateExpenses(built, existingExpenses) : built;
  }, [step, rows, headerRow, mapping, target, existing, existingExpenses, debts, fixed, statementBy]);
  const isSelected = (p) => selection[p.index] ?? p.selected;
  // Expense rows aren't shown (or importable) until the repeat check is
  // back — otherwise an already-logged row reads "New" for a moment.
  const checkingDuplicates = step === "preview" && target === "expenses" && existingExpenses === null;
  const chosen = preview.filter(isSelected);

  // A new table, header choice or target means a fresh guess at the columns.
  function remap(nextRows, nextHeaderRow, nextTarget) {
    const headers = nextHeaderRow >= 0 ? nextRows[nextHeaderRow] || [] : [];
    setMapping(autoMapColumns(headers, nextTarget));
    setSelection({});
  }

  function loadSheets(nextSheets) {
    const first = nextSheets[0].rows;
    const detected = detectHeaderRow(first);
    setSheets(nextSheets);
    setSheetIndex(0);
    setHasHeader(detected >= 0);
    setHeaderAt(Math.max(0, detected));
    remap(first, detected, target);
    setError(null);
    setStep("setup");
  }

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires
    if (!file) return;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!SPREADSHEET_EXTENSIONS.includes(ext)) {
      setError(`"${file.name}" doesn't look like a spreadsheet — choose a .numbers, .xlsx, .xls or .csv file.`);
      return;
    }
    setReading(true);
    setError(null);
    try {
      const read = await readSpreadsheetFile(file);
      if (read.length === 0) setError(`"${file.name}" doesn't have any filled-in cells.`);
      else loadSheets(read);
    } catch (err) {
      console.error(err);
      setError(`Couldn't read "${file.name}". If it's a Numbers file, try File → Export To → Excel (or CSV) in Numbers and import that instead.`);
    }
    setReading(false);
  }

  function readPaste() {
    const parsed = parseDelimited(pasteText);
    if (parsed.length === 0) {
      setError("Nothing to import — paste some cells first.");
      return false;
    }
    loadSheets([{ name: "Pasted cells", rows: parsed }]);
    return false;
  }

  async function goToPreview() {
    setSelection({});
    setExistingExpenses(null);
    setStep("preview");
    if (target === "expenses") {
      // Pull what's already logged over the same dates, to flag repeats.
      const dates = buildPreview({ rows, headerRow, mapping, target }).map((p) => p.values.date).filter(Boolean).sort();
      if (dates.length) {
        const { data, error: dupError } = await supabase.from("expenses").select("date, amount, note").gte("date", dates[0]).lte("date", dates[dates.length - 1]);
        if (dupError) console.error(dupError);
        setExistingExpenses(data || []);
      } else {
        setExistingExpenses([]);
      }
    }
  }

  async function runImport() {
    if (target === "expenses") {
      if (h.sandboxActive) return;
      setImporting(true);
      setProgress(0);
      const payload = chosen.map((p) => ({
        user_id: h.userId, user_name: h.userName,
        amount: p.values.amount, category: p.values.category, note: p.values.note || null, date: p.values.date,
      }));
      let inserted = 0;
      for (let i = 0; i < payload.length; i += EXPENSE_BATCH) {
        const batch = payload.slice(i, i + EXPENSE_BATCH);
        const { error: insertError } = await supabase.from("expenses").insert(batch);
        if (insertError) {
          console.error(insertError);
          setResult({ added: inserted, failed: payload.length - inserted, error: insertError.message });
          setImporting(false);
          setStep("done");
          return;
        }
        inserted += batch.length;
        setProgress(inserted);
      }
      setResult({ added: inserted });
      setImporting(false);
      setStep("done");
      return;
    }
    let added = 0;
    let updated = 0;
    if (target === "statement") {
      let flagged = 0;
      for (const p of chosen) {
        const update = p.target === "debts" ? h.updateDebt : h.updateFixed;
        if (p.kind === "new") {
          if (p.target === "debts") h.addDebt(p.fields);
          else h.addFixed(p.fields);
          added++;
        } else if (p.kind === "update") {
          update(p.existingId, p.patch);
          updated++;
        } else if (p.kind === "missing") {
          update(p.existingId, p.patch);
          flagged++;
        }
      }
      setResult({ added, updated, flagged });
      setStep("done");
      return;
    }
    for (const p of chosen) {
      if (p.match.kind === "update") {
        const patch = patchFrom(p.match.changes, p.values);
        if (target === "debts") h.updateDebt(p.match.existingId, patch);
        else h.updateFixed(p.match.existingId, patch);
        updated++;
      } else {
        if (target === "debts") h.addDebt(newDebtFrom(p.values));
        else h.addFixed(newFixedFrom(p.values));
        added++;
      }
    }
    setResult({ added, updated });
    setStep("done");
  }

  const missingRequired = fields.filter((f) => f.required && (mapping[f.key] === null || mapping[f.key] === undefined));
  const blockedBySandbox = target === "expenses" && h.sandboxActive;
  const noun = target === "debts" ? "debt" : target === "fixed" ? "fixed expense" : target === "statement" ? "bill" : "expense";
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  // onDone returning false keeps the sheet open; the async steps can't
  // return that themselves (they return a Promise), so they're wrapped.
  const stepProps = {
    source: { onDone: readPaste, doneLabel: "Next", doneDisabled: reading || !pasteText.trim() },
    setup: { onBack: () => setStep("source"), onDone: () => { goToPreview(); return false; }, doneLabel: "Review", doneDisabled: missingRequired.length > 0 || blockedBySandbox },
    preview: { onBack: () => setStep("setup"), onDone: () => { runImport(); return false; }, doneLabel: importing ? "Importing…" : `Import ${chosen.length}`, doneDisabled: importing || checkingDuplicates || chosen.length === 0 || blockedBySandbox },
    done: { onDone: () => undefined, doneLabel: "Done", cancelLabel: null },
  }[step];

  return (
    <Sheet title="Import" onClose={onClose} {...stepProps}>
      {step === "source" && (
        <>
          <ListSection
            header="From a file"
            footer="A Numbers file (.numbers), Excel (.xlsx, .xls) or CSV. If a Numbers file won't open, use File → Export To → Excel or CSV in Numbers and pick that."
          >
            <label className="row row-button row-action file-row">
              <FileSpreadsheet size={18} aria-hidden="true" /> {reading ? "Reading…" : "Choose File…"}
              <input type="file" accept={spreadsheetAccept()} onChange={pickFile} hidden disabled={reading} data-testid="import-file" />
            </label>
          </ListSection>
          <ListSection header="Or paste cells" footer="In Numbers, select the cells — header row included — choose Copy, then paste them here.">
            <div className="row paste-row">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={"Name\tBalance\tPayment\nAmex\t$3,400\t$120"}
                rows={5}
                aria-label="Pasted cells"
              />
            </div>
          </ListSection>
          {error && <p className="inline-warning" role="alert">{error}</p>}
        </>
      )}

      {step === "setup" && (
        <>
          <ListSection header="Table" footer={`${plural(Math.max(0, rows.length - (headerRow + 1)), "row")} to import.`}>
            {sheets.length > 1 && (
              <SelectField
                label="Sheet / table"
                value={String(sheetIndex)}
                onChange={(v) => {
                  const i = Number(v);
                  const nextRows = sheets[i].rows;
                  const detected = detectHeaderRow(nextRows);
                  setSheetIndex(i);
                  setHasHeader(detected >= 0);
                  setHeaderAt(Math.max(0, detected));
                  remap(nextRows, detected, target);
                }}
                options={sheets.map((s, i) => ({ value: String(i), label: s.name }))}
              />
            )}
            <SwitchRow
              label={headerAt > 0 ? `Headers on row ${headerAt + 1}` : "First row is headers"}
              checked={hasHeader}
              onChange={(on) => { setHasHeader(on); remap(rows, on ? headerAt : -1, target); }}
            />
          </ListSection>

          <ListSection header="Import into">
            <div className="row segmented-row">
              <SegmentedControl
                options={TARGET_OPTIONS}
                value={target}
                onChange={(t) => { setTarget(t); remap(rows, headerRow, t); }}
                label="Import into"
              />
            </div>
          </ListSection>
          {blockedBySandbox && (
            <Banner tone="warning">Expenses import straight into the shared expense list, so they can't be imported in Sandbox — exit Sandbox first.</Banner>
          )}

          <ListSection
            header="Columns"
            footer={missingRequired.length
              ? `Pick a column for ${missingRequired.map((f) => f.label).join(" and ")} to continue.`
              : target === "statement"
                ? "Every bill is matched by name across Debts and Fixed Expenses. Payoffs and APRs on the list are taken as current (a missing payoff is cleared and marked as needing info). A different monthly payment or due day, an APR the list doesn't have, and bills the list doesn't mention are flagged for review — not changed."
                : target === "expenses"
                ? "Each row becomes a new expense."
                : `Rows are matched to your existing ${IMPORT_TARGETS[target].label.toLowerCase()} by name: a match is updated (only the columns mapped here), anything else is added.`}
          >
            {fields.map((f) => (
              <SelectField
                key={f.key}
                label={f.required ? `${f.label} *` : f.label}
                value={mapping[f.key] === null || mapping[f.key] === undefined ? "" : String(mapping[f.key])}
                onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === "" ? null : Number(v) }))}
                options={[{ value: "", label: "—" }, ...labels.map((l, i) => ({ value: String(i), label: l }))]}
              />
            ))}
          </ListSection>
        </>
      )}

      {checkingDuplicates && <p className="muted center" role="status">Checking for expenses you've already logged…</p>}
      {step === "preview" && !checkingDuplicates && (
        <>
          <div className="import-summary">
            <span>
              {chosen.length} of {preview.length} selected
              {target !== "expenses" && target !== "statement" && ` · ${chosen.filter((p) => p.match.kind !== "update").length} new · ${plural(chosen.filter((p) => p.match.kind === "update").length, "update")}`}
            </span>
            <span>
              <button type="button" className="btn-link small" onClick={() => setSelection(Object.fromEntries(preview.map((p) => [p.index, true])))}>All</button>
              {" · "}
              <button type="button" className="btn-link small" onClick={() => setSelection(Object.fromEntries(preview.map((p) => [p.index, false])))}>None</button>
            </span>
          </div>
          {importing && <p className="muted small">Imported {progress} of {chosen.length}…</p>}
          {blockedBySandbox && <Banner tone="warning">Exit Sandbox to import expenses.</Banner>}
          {target === "statement" && (
            <ListSection footer="Payoffs taken from the list are stamped as updated today, so only payments made after today come off them.">
              {preview.map((p) => {
                const on = isSelected(p);
                const [badgeText, badgeClass] = p.problems.length ? ["Skipped", "badge-red"] : STATEMENT_BADGE[p.kind === "new" ? `new-${p.target}` : p.kind];
                return (
                  <button
                    key={p.index}
                    type="button"
                    className={`row row-button import-row ${on ? "" : "unselected"}`}
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => setSelection((s) => ({ ...s, [p.index]: !on }))}
                  >
                    {on ? <CheckCircle2 size={22} className="import-check on" aria-hidden="true" /> : <Circle size={22} className="import-check" aria-hidden="true" />}
                    <span className="row-body">
                      <span className="row-title">{p.name || "(no name)"} <span className={`badge ${badgeClass}`}>{badgeText}</span></span>
                      <span className={`row-subtitle ${p.problems.length ? "tone-red" : ""}`}>
                        {p.rowNumber ? `Row ${p.rowNumber} · ` : ""}{(p.problems.length ? p.problems : p.notes).join("; ") || describeValues(p.fields || {}, "debts")}
                      </span>
                    </span>
                  </button>
                );
              })}
            </ListSection>
          )}
          {target !== "statement" && <ListSection>
            {preview.map((p) => {
              const on = isSelected(p);
              const [badgeText, badgeClass] = p.problems.length ? ["Can't import as is", "badge-red"] : MATCH_BADGE[p.match.kind];
              const title = target === "expenses"
                ? `${p.values.amount !== null ? money(p.values.amount) : "—"} · ${p.values.note || p.values.category}`
                : p.values.name || "(no name)";
              const detail = p.problems.length
                ? p.problems.join("; ")
                : p.match.kind === "update"
                  ? (p.match.changes.length ? p.match.changes.map(formatChange).join(", ") : `no changes to ${p.match.existingName}`)
                  : describeValues(p.values, target);
              return (
                <button
                  key={p.index}
                  type="button"
                  className={`row row-button import-row ${on ? "" : "unselected"}`}
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => setSelection((s) => ({ ...s, [p.index]: !on }))}
                >
                  {on ? <CheckCircle2 size={22} className="import-check on" aria-hidden="true" /> : <Circle size={22} className="import-check" aria-hidden="true" />}
                  <span className="row-body">
                    <span className="row-title">{title} <span className={`badge ${badgeClass}`}>{badgeText}</span></span>
                    <span className={`row-subtitle ${p.problems.length ? "tone-red" : ""}`}>Row {p.rowNumber} · {detail}</span>
                  </span>
                </button>
              );
            })}
          </ListSection>}
        </>
      )}

      {step === "done" && result && (
        <ListSection footer={target === "expenses" ? "They're on the Expenses tab." : target === "statement" ? "Bills needing review or info are marked on the Debts and Fixed Expenses tabs." : `Edit any of them on the ${IMPORT_TARGETS[target].label} tab.`}>
          {result.added > 0 && <ListRow title={`Added ${plural(result.added, noun)}`} accessory={<CheckCircle2 size={20} className="tone-green" />} />}
          {result.updated > 0 && <ListRow title={`Updated ${plural(result.updated, noun)}`} accessory={<CheckCircle2 size={20} className="tone-green" />} />}
          {result.failed > 0 && <ListRow title={`${plural(result.failed, noun)} not imported`} subtitle={result.error} />}
          {result.flagged > 0 && <ListRow title={`Flagged ${plural(result.flagged, "bill")} not on the list for review`} />}
          {!result.added && !result.updated && !result.failed && !result.flagged && <ListRow title="Nothing was imported" />}
        </ListSection>
      )}
    </Sheet>
  );
}
