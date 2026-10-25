// Postgres hands jsonb back with its keys re-sorted, so the household blob
// built in the app and the same blob read back from Supabase never compare
// equal as plain JSON strings. Sorting keys first makes "is this actually
// different from what's saved?" a real question.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : stableStringify(v))).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sameData(a, b) {
  return stableStringify(a) === stableStringify(b);
}
