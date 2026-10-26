// src/utils/importParse.js
//
// Turning a spreadsheet (a Numbers/Excel/CSV file read by SheetJS, or cells
// pasted straight from Numbers) into debts, fixed expenses or expenses.
// Everything here is plain data in, plain data out — the file reading
// itself lives in lib/spreadsheet.js so SheetJS only loads when needed.

import { CATEGORY_OPTIONS, EXPENSE_CATEGORIES, FIXED_CATEGORY_OPTIONS } from "../data/constants";

// ---------- pasted text ----------

// Cells copied from Numbers arrive as tab-separated text (CSV from other
// sources): quoted cells may hold the delimiter, newlines and "" escapes.
export function parseDelimited(text) {
  const src = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes("\t") ? "\t" : (firstLine.split(";").length > firstLine.split(",").length ? ";" : ",");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return trimRows(rows);
}

// Drops blank rows and trailing blank columns; trims every cell.
export function trimRows(rows) {
  const cleaned = rows
    .map((r) => (Array.isArray(r) ? r : []).map((c) => (c === null || c === undefined ? "" : String(c).trim())))
    .filter((r) => r.some((c) => c !== ""));
  const width = cleaned.reduce((w, r) => {
    let last = r.length - 1;
    while (last >= 0 && r[last] === "") last--;
    return Math.max(w, last + 1);
  }, 0);
  return cleaned.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
}

// ---------- values ----------

// "$1,234.56" → 1234.56, "(45.00)" → -45, "1 234,50" stays unparsed (null)
// rather than guessed. Blank → null.
export function parseMoney(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = String(value ?? "").trim();
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[$€£¥\s]|USD|US\$/gi, "").replace(/,/g, "");
  if (s.startsWith("-")) { negative = !negative; s = s.slice(1); }
  if (s.endsWith("-")) { negative = !negative; s = s.slice(0, -1); }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

// "24.99%" → 24.99. A bare fraction under 1 ("0.2499", what a percent cell
// can hold underneath) is read as 24.99 — no APR is really a quarter of a
// percent, so that's the only sensible reading.
export function parsePercent(value) {
  const s = String(value ?? "").trim();
  if (s === "") return null;
  const hadSign = s.includes("%");
  const n = parseMoney(s.replace(/%/g, "").replace(/apr/i, ""));
  if (n === null) return null;
  return !hadSign && n > 0 && n < 1 ? Math.round(n * 1e6) / 1e4 : n;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(y, m, d) {
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// A calendar date as YYYY-MM-DD, from the formats spreadsheets actually
// produce: 2026-10-25, 10/25/2026, 10/25/26, Oct 25, 2026, 25 Oct 2026,
// or a raw spreadsheet serial number. US month/day order for slashes.
export function parseDate(value) {
  if (value instanceof Date && !isNaN(value)) return iso(value.getFullYear(), value.getMonth() + 1, value.getDate());
  const s = String(value ?? "").trim();
  if (s === "") return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(s);
  if (m && MONTHS.includes(m[1].toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  m = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/i.exec(s);
  if (m && MONTHS.includes(m[2].toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Spreadsheet serial: days since 1899-12-30.
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}

// "15", "15th", "the 15th", or a full date (its day of the month).
export function parseDueDay(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "") return null;
  const m = /^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$/.exec(s);
  const day = m ? Number(m[1]) : (() => { const d = parseDate(s); return d ? Number(d.slice(8, 10)) : null; })();
  return day >= 1 && day <= 31 ? day : null;
}

// "1"–"4", the tier names, or anything saying "minimum only / forever".
export function parseTier(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "") return null;
  if (/\b(protected|forever|minimum|min only|never)\b/.test(s)) return { protected: true, priority: null };
  const n = /^(?:tier\s*)?([1-4])\b/.exec(s);
  if (n) return { protected: false, priority: Number(n[1]) };
  const names = { "quick win": 1, "core": 2, "large": 3, "depriorit": 4 };
  for (const [key, priority] of Object.entries(names)) if (s.includes(key)) return { protected: false, priority };
  return null;
}

const TYPE_SYNONYMS = {
  "Credit Card": ["credit", "card", "cc", "visa", "mastercard", "amex", "discover"],
  "Personal Loan": ["personal"],
  "Auto Loan": ["auto", "car", "vehicle", "truck"],
  "Student Loan": ["student", "education"],
  "Bootcamp Loan": ["bootcamp"],
  "Retail Card": ["retail", "store"],
  "Other Loan": ["loan"],
  "Rent/Mortgage": ["rent", "mortgage", "housing", "lease"],
  "Utility": ["utility", "utilities", "power", "electric", "water", "gas bill", "internet", "phone"],
  "Childcare": ["childcare", "daycare", "child care"],
  "Insurance": ["insurance"],
  "Subscription": ["subscription", "streaming", "membership"],
  Groceries: ["grocery", "groceries", "supermarket"],
  Gas: ["gas", "fuel"],
  "Fast Food": ["fast food"],
  "Dining Out": ["dining", "restaurant"],
  Subscriptions: ["subscription"],
};

const wordIn = (word, text) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\b`).test(text);

// The closest of `options` to a free-text value — exact (ignoring case),
// then the whole option name inside the value ("my credit card"), then a
// synonym as a whole word ("car" → Auto Loan, never "credit card") — or null.
export function matchOption(value, options) {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "") return null;
  const exact = options.find((o) => o.toLowerCase() === s);
  if (exact) return exact;
  const contained = options.find((o) => wordIn(o.toLowerCase(), s));
  if (contained) return contained;
  for (const o of options) {
    if ((TYPE_SYNONYMS[o] || []).some((syn) => wordIn(syn, s))) return o;
  }
  return null;
}

// ---------- columns ----------

export const IMPORT_TARGETS = {
  // Bring every bill current from a payoff list — see utils/statementSync.js.
  statement: {
    label: "Statement",
    fields: [
      { key: "name", label: "Bill", required: true, headers: ["bill", "name", "debt", "account", "creditor", "lender", "card", "description"] },
      { key: "balance", label: "Payoff", headers: ["payoff", "payoffs", "balance", "currentbalance", "owed", "amountowed", "remaining"] },
      { key: "monthly", label: "Monthly payment", headers: ["monthly", "payment", "monthlypayment", "min", "minimum", "minpayment", "minimumpayment", "amountdue"] },
      { key: "apr", label: "APR %", headers: ["apr", "rate", "interest", "interestrate"] },
      { key: "dueDay", label: "Due day", headers: ["due", "dueday", "duedate", "day"] },
    ],
  },
  debts: {
    label: "Debts",
    fields: [
      { key: "name", label: "Name", required: true, headers: ["name", "debt", "account", "creditor", "lender", "card", "bill", "description"] },
      { key: "balance", label: "Balance", headers: ["balance", "currentbalance", "owed", "amountowed", "principal", "payoff", "remaining"] },
      { key: "monthly", label: "Monthly payment", headers: ["monthly", "payment", "monthlypayment", "min", "minimum", "minpayment", "minimumpayment", "minimumdue", "amountdue"] },
      { key: "apr", label: "APR %", headers: ["apr", "rate", "interest", "interestrate"] },
      { key: "dueDay", label: "Due day", headers: ["due", "dueday", "duedate", "day"] },
      { key: "type", label: "Type", headers: ["type", "kind", "category"] },
      { key: "tier", label: "Tier", headers: ["tier", "priority", "payofftier"] },
    ],
  },
  fixed: {
    label: "Fixed Expenses",
    fields: [
      { key: "name", label: "Name", required: true, headers: ["name", "expense", "bill", "payee", "description", "item"] },
      { key: "monthly", label: "Monthly amount", required: true, headers: ["monthly", "amount", "payment", "cost", "price", "monthlyamount"] },
      { key: "dueDay", label: "Due day", headers: ["due", "dueday", "duedate", "day"] },
      { key: "type", label: "Type", headers: ["type", "kind", "category"] },
      { key: "note", label: "Note", headers: ["note", "notes", "memo", "comment", "comments"] },
    ],
  },
  expenses: {
    label: "Expenses",
    fields: [
      { key: "date", label: "Date", required: true, headers: ["date", "day", "posted", "transactiondate", "posteddate"] },
      { key: "amount", label: "Amount", required: true, headers: ["amount", "total", "cost", "price", "spent", "debit"] },
      { key: "category", label: "Category", headers: ["category", "type", "kind"] },
      { key: "note", label: "Merchant / note", headers: ["merchant", "description", "note", "notes", "memo", "payee", "name", "store"] },
    ],
  },
};

function normalizeHeader(h) {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function headerScore(header, field) {
  const h = normalizeHeader(header);
  if (!h) return 0;
  let best = 0;
  for (const syn of field.headers) {
    if (h === syn) best = Math.max(best, 3);
    else if (h.startsWith(syn) || h.endsWith(syn)) best = Math.max(best, 2);
    else if (syn.length >= 3 && h.includes(syn)) best = Math.max(best, 1);
  }
  return best;
}

// The header row: whichever of the first few rows names the most known
// columns. -1 when nothing looks like a header (data starts at row 0).
export function detectHeaderRow(rows) {
  const allFields = Object.values(IMPORT_TARGETS).flatMap((t) => t.fields);
  let bestRow = -1;
  let bestHits = 1; // needs at least two recognizable headers
  rows.slice(0, 10).forEach((row, i) => {
    const hits = row.filter((cell) => allFields.some((f) => headerScore(cell, f) >= 2) && parseMoney(cell) === null).length;
    if (hits > bestHits) { bestHits = hits; bestRow = i; }
  });
  return bestRow;
}

// Assigns each field its best-matching column (each column used once),
// strongest matches first. { fieldKey: columnIndex | null }
export function autoMapColumns(headers, target) {
  const fields = IMPORT_TARGETS[target].fields;
  const candidates = [];
  fields.forEach((f, fi) => headers.forEach((h, ci) => {
    const score = headerScore(h, f);
    if (score > 0) candidates.push({ key: f.key, fi, ci, score });
  }));
  candidates.sort((a, b) => b.score - a.score || a.fi - b.fi || a.ci - b.ci);
  const mapping = Object.fromEntries(fields.map((f) => [f.key, null]));
  const usedCols = new Set();
  for (const c of candidates) {
    if (mapping[c.key] !== null || usedCols.has(c.ci)) continue;
    mapping[c.key] = c.ci;
    usedCols.add(c.ci);
  }
  return mapping;
}

// ---------- preview ----------

function nameKey(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseRow(cells, mapping, target) {
  const get = (key) => (mapping[key] === null || mapping[key] === undefined ? "" : cells[mapping[key]] ?? "");
  const has = (key) => mapping[key] !== null && mapping[key] !== undefined && String(get(key)).trim() !== "";
  if (target === "expenses") {
    return {
      date: parseDate(get("date")),
      amount: parseMoney(get("amount")),
      category: has("category") ? matchOption(get("category"), EXPENSE_CATEGORIES) || "Other" : "Other",
      note: has("note") ? String(get("note")).trim() : "",
    };
  }
  const values = { name: String(get("name")).trim() };
  if (has("monthly")) values.monthly = parseMoney(get("monthly"));
  if (has("dueDay")) values.dueDay = parseDueDay(get("dueDay"));
  if (target === "debts") {
    if (has("balance")) values.balance = parseMoney(get("balance"));
    if (has("apr")) values.apr = parsePercent(get("apr"));
    if (has("type")) values.type = matchOption(get("type"), CATEGORY_OPTIONS) || "Other Loan";
    if (has("tier")) values.tier = parseTier(get("tier"));
  } else {
    if (has("type")) values.type = matchOption(get("type"), FIXED_CATEGORY_OPTIONS) || "Other";
    if (has("note")) values.note = String(get("note")).trim();
  }
  return values;
}

function problemsFor(values, target, cells, mapping) {
  const problems = [];
  const raw = (key) => (mapping[key] === null || mapping[key] === undefined ? "" : String(cells[mapping[key]] ?? "").trim());
  if (target === "expenses") {
    if (!values.date) problems.push(raw("date") ? `can't read date "${raw("date")}"` : "no date");
    if (values.amount === null) problems.push(raw("amount") ? `can't read amount "${raw("amount")}"` : "no amount");
    else if (values.amount <= 0) problems.push("amount isn't positive");
    return problems;
  }
  if (!values.name) problems.push("no name");
  for (const key of ["monthly", "balance", "apr", "dueDay"]) {
    if (key in values && values[key] === null) problems.push(`can't read ${key === "dueDay" ? "due day" : key} "${raw(key)}"`);
  }
  if (target === "fixed" && !("monthly" in values)) problems.push("no monthly amount");
  if (target === "debts" && !("monthly" in values) && !("balance" in values)) problems.push("no balance or monthly payment");
  return problems;
}

// What importing this row would change on an existing item — only the
// columns that were mapped and actually hold a value.
function changesFor(values, item, target) {
  const changes = [];
  const cmp = (key, next, label = key) => {
    if (next === undefined || next === null) return;
    const prev = item[key];
    if (String(prev ?? "") !== String(next)) changes.push({ key, label, from: prev ?? null, to: next });
  };
  cmp("monthly", values.monthly, "monthly");
  cmp("dueDay", values.dueDay, "due day");
  cmp("type", values.type, "type");
  if (target === "debts") {
    cmp("balance", values.balance, "balance");
    cmp("apr", values.apr, "APR");
    if (values.tier) {
      if (values.tier.protected && !item.protected) changes.push({ key: "tier", label: "tier", from: item.priority, to: "minimum only" });
      if (!values.tier.protected && (item.protected || Number(item.priority) !== values.tier.priority)) {
        changes.push({ key: "tier", label: "tier", from: item.protected ? "minimum only" : item.priority, to: values.tier.priority });
      }
    }
  } else {
    cmp("note", values.note || undefined, "note");
  }
  return changes;
}

// One preview row per spreadsheet row: the parsed values, anything wrong
// with it, and — for debts/fixed — whether it updates an existing item
// (matched by name) or adds a new one. `selected` is the sensible default
// for its checkbox; `existing` is the target list the app already has.
export function buildPreview({ rows, headerRow, mapping, target, existing = [] }) {
  const dataRows = rows.slice(headerRow + 1);
  const byName = new Map();
  for (const item of existing) {
    const key = nameKey(item.name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) || []), item]);
  }
  const claimed = new Set();
  return dataRows.map((cells, i) => {
    const values = parseRow(cells, mapping, target);
    const problems = problemsFor(values, target, cells, mapping);
    const preview = { index: i, rowNumber: headerRow + 2 + i, values, problems, match: { kind: "new" }, selected: problems.length === 0 };
    if (target === "expenses" || !values.name) return preview;
    const matches = byName.get(nameKey(values.name)) || [];
    if (matches.length > 1) {
      preview.match = { kind: "ambiguous", count: matches.length };
      preview.selected = false; // two existing items share this name — don't guess which one
    } else if (matches.length === 1) {
      const item = matches[0];
      if (claimed.has(item.id)) {
        preview.match = { kind: "repeat", existingName: item.name };
        preview.selected = false; // an earlier row already updates it
      } else {
        claimed.add(item.id);
        const changes = changesFor(values, item, target);
        preview.match = { kind: "update", existingId: item.id, existingName: item.name, changes };
        if (changes.length === 0) preview.selected = false;
      }
    }
    return preview;
  });
}

// Flags expense rows that look already logged (same date, amount and note).
export function markDuplicateExpenses(preview, existingExpenses) {
  const seen = new Set(existingExpenses.map((e) => `${e.date}|${Number(e.amount).toFixed(2)}|${nameKey(e.note)}`));
  return preview.map((p) => {
    if (p.problems.length) return p;
    const key = `${p.values.date}|${Number(p.values.amount).toFixed(2)}|${nameKey(p.values.note)}`;
    return seen.has(key) ? { ...p, match: { kind: "duplicate" }, selected: false } : p;
  });
}

// ---------- applying ----------

export function newDebtFrom(values) {
  return {
    name: values.name,
    type: values.type || "Other Loan",
    monthly: values.monthly ?? 0,
    balance: values.balance ?? null,
    apr: values.apr ?? null,
    dueDay: values.dueDay ?? null,
    graceDays: 0,
    priority: values.tier?.protected ? null : values.tier?.priority ?? 2,
    protected: !!values.tier?.protected,
    excludeFromGoal: !!values.tier?.protected,
  };
}

export function newFixedFrom(values) {
  return {
    name: values.name,
    type: values.type || "Other",
    monthly: values.monthly ?? 0,
    dueDay: values.dueDay ?? null,
    graceDays: 0,
    note: values.note || "",
  };
}

// The patch for an existing debt/fixed expense from a preview's changes.
export function patchFrom(changes, values) {
  const patch = {};
  for (const c of changes) {
    if (c.key === "tier") Object.assign(patch, values.tier.protected
      ? { protected: true, priority: null, excludeFromGoal: true }
      : { protected: false, priority: values.tier.priority, excludeFromGoal: false });
    else patch[c.key] = c.to;
  }
  return patch;
}

// Column labels for the mapping pickers: the header text, or A, B, C…
export function columnLabels(rows, headerRow) {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const letter = (i) => (i >= 26 ? letter(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));
  return Array.from({ length: width }, (_, i) => {
    const h = headerRow >= 0 ? String(rows[headerRow]?.[i] ?? "").trim() : "";
    return h ? `${h} (${letter(i)})` : `Column ${letter(i)}`;
  });
}
