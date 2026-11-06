import "server-only";
import ExcelJS from "exceljs";
import * as SSF from "ssf";
import { SaxesParser } from "saxes";
import { parse } from "csv-parse/sync";
import { zipSync } from "fflate";
import { canonicalOOXML } from "./ooxml";
import { readOfficeArchive } from "./office-archive";
import { fail, ImportError, diagnostic, type ImportDiagnostic } from "./diagnostics";
import {
  MAX_FILE_BYTES,
  MAX_REVIEW_ROWS,
  MAX_COLUMNS,
  SPREADSHEET_FORMATS,
} from "./upload-contract";
export type ExtractedSheet = {
  name: string;
  rows: { row: number; cells: string[] }[];
  issue?: ImportDiagnostic;
};
export type SpreadsheetExtraction = { name: string; sheets: ExtractedSheet[] };
function validateExtractedRows(rows: ExtractedSheet["rows"], worksheet: string) {
  const populated = rows.filter((r) => r.cells.some((c) => c.trim()));
  if (populated.length > MAX_REVIEW_ROWS + 1)
    fail(
      "ROW_LIMIT",
      `Use at most ${MAX_REVIEW_ROWS} populated review rows plus a header; save at most 200 knowledge records.`,
      {
        worksheet,
        row: populated[MAX_REVIEW_ROWS + 1].row,
      },
    );
  for (const r of rows) {
    if (r.row > 10000)
      fail("ROW_LIMIT", "Split this source into files within physical row 10,000.", {
        worksheet,
        row: r.row,
      });
    if (r.cells.slice(MAX_COLUMNS).some((v) => v.trim()))
      fail("COLUMN_LIMIT", "Use at most 32 populated columns.", {
        worksheet,
        row: r.row,
        column: "33",
      });
    for (const [i, v] of r.cells.entries())
      if (v.length > 12000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v))
        fail(
          "CELL_VALUE",
          "Remove control characters and keep each cell within 12,000 characters.",
          { worksheet, row: r.row, column: String(i + 1) },
        );
  }
}
function csvDelimiter(text: string) {
  const totals = new Map([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  let quoted = false,
    records = 0;
  for (let i = 0; i < text.length && records < 20; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && c === "\n") records++;
    else if (!quoted && totals.has(c)) totals.set(c, totals.get(c)! + 1);
  }
  return [...totals].sort((a, b) => b[1] - a[1])[0][0];
}
export async function extractSpreadsheet(file: File): Promise<SpreadsheetExtraction> {
  if (!file.size)
    fail("EMPTY_FILE", "The selected file is empty. Add a header and knowledge records first.");
  if (file.size > MAX_FILE_BYTES) fail("FILE_LIMIT", "Choose a file no larger than 2 MiB.");
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (!(SPREADSHEET_FORMATS as readonly string[]).includes(extension ?? ""))
    fail(
      "FILE_TYPE",
      "Choose .csv or .xlsx. PDF, DOCX, XLS and macro-enabled workbooks are not supported.",
    );
  const sheets: ExtractedSheet[] = [];
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
        delimiter: csvDelimiter(text.replace(/\r\n|\r/g, "\n")),
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        max_record_size: 400000,
        info: true,
        raw: true,
      }) as unknown as { record: string[]; info: { lines: number }; raw: string }[];
      values = parsed.map((r) => {
        // csv-parse raw includes skipped blank lines before a record. They are
        // not part of a quoted multiline value and must not shift provenance.
        const raw = r.raw.replace(/^(?:[ \t]*\n)+/u, "");
        return {
          row: r.info.lines - (raw.match(/\n/g)?.length ?? 0) + (raw.endsWith("\n") ? 1 : 0),
          cells: r.record,
        };
      });
    } else {
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
        fail("CORRUPT_FILE", "This is not a valid XLSX ZIP archive. Save a fresh XLSX copy.");
      let entries: Record<string, Uint8Array>;
      try {
        entries = readOfficeArchive(bytes);
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
            /^(oleObject|oleObjects)$/iu.test(local ?? "") ||
            (name === "[Content_Types].xml" &&
              /macroEnabled|vbaProject/iu.test(attrs.contenttype ?? ""))
          )
            fail(
              "UNSAFE_WORKBOOK",
              "Remove macros and embedded objects, then save a standard XLSX workbook.",
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
      for (const sheet of workbook.worksheets.filter((s) => worksheets!.includes(s.name))) {
        worksheet = sheet.name;
        values = [];
        try {
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
              if (index > MAX_COLUMNS)
                fail("COLUMN_LIMIT", "Use at most 32 populated columns.", location);
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
              else
                fail("CELL_ERROR", "Replace this spreadsheet error with a plain value.", location);
            });
            values.push({
              row: row.number,
              cells: Array.from({ length: cells.length }, (_, i) => cells[i] ?? ""),
            });
          });
          validateExtractedRows(values, worksheet);
          sheets.push({ name: worksheet, rows: values });
        } catch (error) {
          sheets.push({ name: worksheet, rows: [], issue: diagnostic(error) });
        }
      }
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
  if (extension === "csv") {
    validateExtractedRows(values, "CSV");
    sheets.push({ name: "CSV", rows: values });
  }
  return { name: file.name.replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 120), sheets };
}
