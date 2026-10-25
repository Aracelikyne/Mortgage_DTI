import { parseDelimited, trimRows } from "../utils/importParse";

const TEXT_EXTENSIONS = ["csv", "tsv", "txt"];

// Reads a picked file into [{ name, rows }] — one entry per sheet/table,
// each row an array of cell strings as they're displayed ("$1,234.56",
// "24.99%", "10/25/26"). Numbers, Excel and ODS files go through SheetJS,
// imported on demand so its ~1 MB parser never lands in the main bundle;
// plain text goes through the same small parser as pasted cells.
export async function readSpreadsheetFile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (TEXT_EXTENSIONS.includes(ext) || file.type.startsWith("text/")) {
    const rows = parseDelimited(await file.text());
    return rows.length ? [{ name: file.name, rows }] : [];
  }
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return workbook.SheetNames
    .map((name) => ({
      name,
      rows: trimRows(XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: "", blankrows: false })),
    }))
    .filter((sheet) => sheet.rows.length > 0);
}

// iOS Safari greys out any file the `accept` list doesn't recognise — and
// it doesn't reliably map .numbers to a type — so on iPhone/iPad the
// picker gets no filter at all and the file is checked after it's chosen.
export function spreadsheetAccept() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) return undefined;
  return [
    ".numbers", ".xlsx", ".xls", ".ods", ".csv", ".tsv", ".txt",
    "application/vnd.apple.numbers",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv", "text/tab-separated-values", "text/plain",
  ].join(",");
}

export const SPREADSHEET_EXTENSIONS = ["numbers", "xlsx", "xls", "ods", ...TEXT_EXTENSIONS];
