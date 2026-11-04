import "server-only";
import { canonicalOOXML } from "./ooxml";
import ExcelJS from "exceljs";
import * as SSF from "ssf";
import { SaxesParser } from "saxes";
import { parse } from "csv-parse/sync";
import { Unzip, UnzipInflate, zipSync } from "fflate";
import { fail, ImportError } from "./diagnostics";
import { columns, instructions, sampleRecords } from "./templates";
import { MAX_FILE_BYTES, MAX_ROWS, unsafeCell } from "./readiness";

const safeExport = (value: string) => (/^[\s\uFEFF]*[=+@\-]/u.test(value) ? `'${value}` : value);
const csvCell = (value: string) => `"${safeExport(value).replaceAll('"', '""')}"`;
function boundedWorkbook(bytes: Uint8Array) {
  const entries: Record<string, Uint8Array> = Object.create(null);
  const names = new Set<string>();
  let expanded = 0,
    completed = 0;
  const unzip = new Unzip((entry) => {
    if (
      names.has(entry.name) ||
      names.size >= 128 ||
      ![0, 8].includes(entry.compression) ||
      /\.\.|^\/|\\|vba|embeddings|externalLinks/iu.test(entry.name)
    )
      throw new Error("Workbook structure is unsafe or too large.");
    names.add(entry.name);
    const parts: Uint8Array[] = [];
    let size = 0;
    entry.ondata = (error, data, final) => {
      if (error) throw error;
      size += data.length;
      expanded += data.length;
      if (size > 4 * 1024 * 1024 || expanded > 8 * 1024 * 1024)
        throw new Error("Workbook expansion is unsafe or too large.");
      parts.push(data);
      if (final) {
        const value = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) {
          value.set(part, offset);
          offset += part.length;
        }
        entries[entry.name] = value;
        completed++;
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  // Incremental inflation bounds real output, even when ZIP size metadata lies.
  for (let offset = 0; offset < bytes.length; offset += 256)
    unzip.push(bytes.subarray(offset, offset + 256), offset + 256 >= bytes.length);
  if (completed !== names.size) throw new Error("The workbook archive is incomplete.");
  return entries;
}
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
  if (!file.size)
    fail("EMPTY_FILE", "The selected file is empty. Add a header and knowledge records first.");
  if (file.size > MAX_FILE_BYTES) fail("FILE_LIMIT", "Choose a file no larger than 2 MiB.");
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (!["csv", "xlsx"].includes(extension ?? ""))
    fail(
      "FILE_TYPE",
      "Choose .csv or .xlsx. PDF, DOCX, XLS and macro-enabled workbooks are not supported.",
    );
  const bytes = Buffer.from(await file.arrayBuffer());
  let values: { row: number; cells: string[] }[] = [],
    worksheet: string | undefined,
    worksheets: string[] | undefined;
  try {
    if (extension === "csv") {
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        fail("CSV_ENCODING", "Save this CSV using UTF-8 encoding, then upload again.");
      }
      if (text.includes("\0"))
        fail("CSV_ENCODING", "The CSV contains binary data. Save a UTF-8 text CSV.");
      const parsed = parse(text.replace(/\r\n|\r/g, "\n"), {
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        max_record_size: 400000,
        info: true,
        raw: true,
      }) as unknown as { record: string[]; info: { lines: number }; raw: string }[];
      values = parsed.map((r) => ({
        row:
          r.info.lines -
          (r.raw.match(/\r\n|\r|\n/g)?.length ?? 0) +
          (/(?:\r\n|\r|\n)$/.test(r.raw) ? 1 : 0),
        cells: r.record,
      }));
    } else {
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
        fail("CORRUPT_FILE", "This is not a valid XLSX ZIP archive. Save a fresh XLSX copy.");
      let entries: Record<string, Uint8Array>;
      try {
        entries = boundedWorkbook(bytes);
      } catch (error) {
        fail(
          "WORKBOOK_STRUCTURE",
          error instanceof Error ? error.message : "The workbook archive is malformed.",
        );
      }
      if (!entries["[Content_Types].xml"] || !entries["xl/workbook.xml"])
        fail("CORRUPT_FILE", "The archive is missing required XLSX workbook parts.");
      for (const [name, entry] of Object.entries(entries)) {
        if (!/\.(xml|rels)$/i.test(name)) continue;
        const xml = new TextDecoder("utf-8", { fatal: true }).decode(entry);
        let cellCount = 0;
        const parser = new SaxesParser();
        parser.on("doctype", () =>
          fail("UNSAFE_WORKBOOK", "XML entities and document types are not supported."),
        );
        parser.on("opentag", (tag) => {
          const local = tag.name.split(":").at(-1);
          const attrs = Object.fromEntries(
            Object.entries(tag.attributes).map(([k, v]) => [
              k.split(":").at(-1)!.toLowerCase(),
              String(v),
            ]),
          );
          if (
            local === "Relationship" &&
            attrs.targetmode === "External" &&
            (!attrs.type?.endsWith("/hyperlink") ||
              !/^(https?:|mailto:|#)/iu.test(attrs.target ?? ""))
          )
            fail(
              "EXTERNAL_REFERENCE",
              "Remove external workbook links, remote data connections and unsafe hyperlinks.",
            );
          if (/xl\/worksheets\/[^/]+\.xml$/i.test(name)) {
            if (
              (local === "c" && ++cellCount > 10000) ||
              (local === "row" && Number(attrs.r) > 10000)
            )
              fail(
                "WORKBOOK_LIMIT",
                "The workbook exceeds the safe structural limit of 10,000 cells or physical row 10,000 per worksheet.",
              );
          }
        });
        parser.write(xml).close();
        entries[name] = canonicalOOXML(xml);
        if (entries[name].length > 4 * 1024 * 1024)
          fail("WORKBOOK_LIMIT", "The normalized worksheet exceeds the safe XML size limit.");
      }
      if (Object.values(entries).reduce((n, e) => n + e.length, 0) > 8 * 1024 * 1024)
        fail("WORKBOOK_LIMIT", "The normalized workbook exceeds the safe expanded size limit.");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(zipSync(entries)) as never);
      if (workbook.worksheets.length > 20) fail("SHEET_LIMIT", "Use no more than 20 worksheets.");
      worksheets = workbook.worksheets.filter((s) => s.state !== "veryHidden").map((s) => s.name);
      const sheet = selected
        ? workbook.getWorksheet(selected)
        : (workbook.getWorksheet("Sample Data") ??
          workbook.worksheets.find(
            (s) => s.name.toLowerCase() !== "instructions" && s.actualRowCount > 0,
          ));
      if (!sheet || !worksheets.includes(sheet.name))
        fail("WORKSHEET", "Select an available data worksheet.", { worksheets });
      worksheet = sheet.name;
      if (sheet.model.merges.length)
        fail(
          "MERGED_CELLS",
          "Unmerge cells in the data worksheet so each column has its own value.",
          { worksheet, worksheets },
        );
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: false }, (cell, index) => {
          const location = { worksheet, row: row.number, column: cell.address, worksheets };
          const value = cell.value;
          if (value == null || (typeof value === "string" && !value.trim())) return;
          if (index > 32) fail("COLUMN_LIMIT", "Use at most 32 populated columns.", location);
          if (typeof value === "string" || typeof value === "boolean")
            cells[index - 1] = String(value);
          else if (typeof value === "number") {
            if ((cell.numFmt ?? "").length > 256)
              fail(
                "NUMBER_FORMAT",
                "Simplify this number format or paste its value as text.",
                location,
              );
            try {
              cells[index - 1] = SSF.format(cell.numFmt || "General", value);
            } catch {
              fail(
                "NUMBER_FORMAT",
                "This number format could not be read. Paste its displayed value as text.",
                location,
              );
            }
          } else if (value instanceof Date) cells[index - 1] = value.toISOString().slice(0, 10);
          else if ("richText" in value)
            cells[index - 1] = value.richText.map((r) => r.text).join("");
          else if ("hyperlink" in value) {
            if (!/^(https?:|mailto:|#)/iu.test(value.hyperlink))
              fail(
                "EXTERNAL_REFERENCE",
                "Use an ordinary web/email hyperlink or plain text.",
                location,
              );
            cells[index - 1] = value.text;
          } else if ("formula" in value || "sharedFormula" in value)
            fail(
              "FORMULA",
              "Formulas are not imported, including cached results. Paste their values instead.",
              location,
            );
          else fail("CELL_ERROR", "Replace this spreadsheet error with a plain value.", location);
        });
        values.push({
          row: row.number,
          cells: Array.from({ length: cells.length }, (_, i) => cells[i] ?? ""),
        });
      });
    }
  } catch (error) {
    if (error instanceof ImportError) throw error;
    const e = error as { code?: string; lines?: number; message?: string };
    fail(
      extension === "csv" ? "CSV_SYNTAX" : "CORRUPT_FILE",
      extension === "csv"
        ? "Check CSV quotes and delimiters. Quote multiline values and double embedded quote characters."
        : "The workbook could not be opened. Save a fresh standards-compliant XLSX copy.",
      { worksheet, worksheets, row: e.lines },
    );
  }
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
