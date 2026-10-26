// 1 → "1st", 22 → "22nd", 13 → "13th".
export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// A stored number as an input's string value, keeping "" for null/undefined.
export function asInput(v) {
  return v === null || v === undefined ? "" : String(v);
}

// An input's string back to a number, or `empty` when it was left blank.
export function fromInput(v, empty = null) {
  return v === "" || v === null || v === undefined ? empty : Number(v);
}

// "2026-10-12" → "10/12/26".
export function shortDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
}
