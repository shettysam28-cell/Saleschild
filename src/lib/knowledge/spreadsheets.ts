import "server-only";
import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";
import { columns, instructions, sampleRecord } from "./templates";
import { MAX_FILE_BYTES, MAX_ROWS, unsafeCell } from "./readiness";

const safeExport = (value: string) => (unsafeCell(value) ? `'${value}` : value);
const csvCell = (value: string) => `"${safeExport(value).replaceAll('"', '""')}"`;
export async function createTemplate(id: string, format: "csv" | "xlsx", filled: boolean) {
  const record = sampleRecord(id);
  const rows = filled ? [columns.map((c) => record[c])] : [];
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

export type ParsedSource = { headers: string[]; rows: string[][]; name: string };
export async function parseSource(file: File): Promise<ParsedSource> {
  if (!file.size || file.size > MAX_FILE_BYTES)
    throw new Error("Upload a non-empty file no larger than 2 MiB.");
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (!extension || !["csv", "xlsx"].includes(extension))
    throw new Error("Choose CSV or XLSX. PDF and DOCX extraction is coming soon.");
  const bytes = Buffer.from(await file.arrayBuffer());
  let values: string[][];
  if (extension === "csv") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error("Choose a UTF-8 CSV file without binary content.");
    values = parse(text, {
      bom: true,
      skip_empty_lines: true,
      max_record_size: 200000,
      relax_column_count: false,
    }) as string[][];
  } else {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
      throw new Error("This file is not an XLSX workbook.");
    let count = 0,
      expanded = 0;
    const names = new Set<string>();
    const entries = unzipSync(bytes, {
      filter: (entry) => {
        count++;
        expanded += entry.originalSize;
        if (names.has(entry.name)) throw new Error("Duplicate workbook parts are not supported.");
        names.add(entry.name);
        if (
          count > 128 ||
          entry.originalSize > 4 * 1024 * 1024 ||
          expanded > 8 * 1024 * 1024 ||
          ![0, 8].includes(entry.compression) ||
          /\.\.|^\/|vba|embeddings|externalLinks/iu.test(entry.name)
        )
          throw new Error("Workbook structure is unsafe or too large.");
        return true;
      },
    });
    if (!entries["[Content_Types].xml"] || !entries["xl/workbook.xml"])
      throw new Error("This archive is not an XLSX workbook.");
    for (const [name, entry] of Object.entries(entries)) {
      if (
        /\.(xml|rels)$/i.test(name) &&
        /<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External|macroEnabled/iu.test(
          new TextDecoder().decode(entry),
        )
      )
        throw new Error("External links, macros and XML entities are not supported.");
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    if (workbook.worksheets.length > 3)
      throw new Error("Keep at most three sheets and use a Sample Data sheet.");
    const sheet =
      workbook.getWorksheet("Sample Data") ??
      workbook.worksheets.find((s) => s.name !== "Instructions");
    if (!sheet || sheet.rowCount > MAX_ROWS + 1 || sheet.columnCount > 32)
      throw new Error("Use a header and at most 200 rows and 32 columns.");
    values = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const fields: string[] = [];
      for (let i = 1; i <= sheet.columnCount; i++) {
        const cell = row.getCell(i),
          value = cell.value;
        if (value === null) fields.push("");
        else if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        )
          fields.push(String(value));
        else if (value instanceof Date) fields.push(value.toISOString().slice(0, 10));
        else
          throw new Error(
            "Use plain values. Formulas, hyperlinks, errors and rich text are not supported.",
          );
      }
      values.push(fields);
    });
  }
  if (values.length < 2 || values.length > MAX_ROWS + 1)
    throw new Error(
      "Use a header row and 1–200 knowledge records. Blank templates must be filled before uploading.",
    );
  const headers = values[0].map((s) => s.trim());
  if (
    headers.length > 32 ||
    headers.some((h) => !h || h.length > 100 || unsafeCell(h)) ||
    new Set(headers).size !== headers.length
  )
    throw new Error("Use unique, non-empty column headers (maximum 32).");
  const rows = values.slice(1);
  if (
    rows.some(
      (row) => row.length !== headers.length || row.some((s) => s.length > 12000 || unsafeCell(s)),
    )
  )
    throw new Error(
      "Remove formulas, control characters, oversized cells or inconsistent columns.",
    );
  return { headers, rows, name: file.name.replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 120) };
}
