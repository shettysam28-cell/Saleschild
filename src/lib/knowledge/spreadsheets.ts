import "server-only";
import ExcelJS from "exceljs";
import { fail, ImportError } from "./diagnostics";
import { extractSpreadsheet } from "./spreadsheet-extraction";
import { columns, instructions, sampleRecords } from "./templates";
import { MAX_ROWS, unsafeCell } from "./readiness";

const safeExport = (value: string) => (/^[\s\uFEFF]*[=+@\-]/u.test(value) ? `'${value}` : value);
const csvCell = (value: string) => `"${safeExport(value).replaceAll('"', '""')}"`;
export async function createTemplate(id: string, format: "csv" | "xlsx", filled: boolean) {
  const records = sampleRecords(id);
  const rows = filled ? records.map((record) => columns.map((c) => record[c])) : [];
  if (format === "csv")
    return Buffer.from(
      [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n",
      "utf8",
    );
  const workbook = new ExcelJS.Workbook();
  const guide = workbook.addWorksheet("Instructions");
  guide.getColumn(1).width = 115;
  guide.addRows([["Saleschild · Start with Your Knowledge"], ...instructions.map((s) => [s])]);
  guide.eachRow((row) => {
    row.height = 44;
    row.alignment = { wrapText: true, vertical: "middle" };
  });
  const sheet = workbook.addWorksheet("Sample Data", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow([...columns]);
  for (const row of rows) sheet.addRow(row.map(safeExport));
  sheet.columns.forEach((col) => {
    col.width = 32;
  });
  sheet.getRow(1).font = { bold: true, color: { argb: "FF090D16" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC8FF5F" } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export type ParsedSource = {
  headers: string[];
  rows: string[][];
  name: string;
  worksheet?: string;
  worksheets?: string[];
  rowNumbers?: number[];
};
export async function parseSource(file: File, selected?: string): Promise<ParsedSource> {
  const extracted = await extractSpreadsheet(file);
  const worksheets = extracted.sheets.map((s) => s.name);
  const sheet = selected
    ? extracted.sheets.find((s) => s.name === selected)
    : (extracted.sheets.find((s) => s.name === "Sample Data") ??
      extracted.sheets.find((s) => s.name.toLowerCase() !== "instructions" && s.rows.length));
  if (!sheet) fail("WORKSHEET", "Select an available data worksheet.", { worksheets });
  if (sheet.issue) throw new ImportError({ ...sheet.issue, worksheets });
  const worksheet = file.name.toLowerCase().endsWith(".csv") ? undefined : sheet.name;
  let values = sheet.rows;
  values = values.filter((r) => r.cells.some((v) => v.trim() !== ""));
  const header = values.shift();
  if (!header)
    fail("EMPTY_SHEET", "The selected worksheet has no header or records.", {
      worksheet,
      worksheets,
    });
  while (header.cells.length && !header.cells.at(-1)?.trim()) header.cells.pop();
  const headers = header.cells.map((s) => s.trim().normalize("NFC"));
  if (headers.length > 32)
    fail("COLUMN_LIMIT", "Use at most 32 populated columns.", {
      worksheet,
      row: header.row,
      worksheets,
    });
  const seen = new Set<string>();
  headers.forEach((h, i) => {
    const key = h.toLowerCase();
    if (!h || h.length > 100 || unsafeCell(h) || seen.has(key))
      fail("HEADERS", "Use unique, non-empty column names (at most 100 characters).", {
        worksheet,
        row: header.row,
        column: String(i + 1),
        worksheets,
      });
    seen.add(key);
  });
  if (values.length > MAX_ROWS)
    fail("ROW_LIMIT", "Use at most 200 non-empty knowledge records in the selected worksheet.", {
      worksheet,
      row: values[MAX_ROWS].row,
      worksheets,
    });
  if (!values.length)
    fail("EMPTY_SHEET", "This template is blank. Fill at least one data row before uploading.", {
      worksheet,
      worksheets,
    });
  for (const row of values) {
    if (row.cells.slice(headers.length).some((v) => v.trim()))
      fail(
        "COLUMNS",
        "This row has data beyond the header columns. Add the missing header or remove the extra value.",
        { worksheet, row: row.row, worksheets },
      );
    row.cells = Array.from({ length: headers.length }, (_, i) => row.cells[i] ?? "");
    row.cells.forEach((v, i) => {
      if (v.length > 12000 || unsafeCell(v))
        fail(
          "CELL_VALUE",
          "Remove formula-like content or control characters; limit each cell to 12,000 characters.",
          { worksheet, row: row.row, column: headers[i], worksheets },
        );
    });
  }
  return {
    headers,
    rows: values.map((r) => r.cells),
    rowNumbers: values.map((r) => r.row),
    worksheet,
    worksheets,
    name: file.name.replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 120),
  };
}
