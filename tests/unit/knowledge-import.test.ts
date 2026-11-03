import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import ExcelJS from "exceljs";
import { zipSync, strToU8 } from "fflate";
import { columns, sampleRecord, sampleRecords, templateLibrary } from "@/lib/knowledge/templates";
import {
  assessReadiness,
  mapRecords,
  curriculumPreview,
  MAX_FILE_BYTES,
} from "@/lib/knowledge/readiness";
import { createTemplate, parseSource } from "@/lib/knowledge/spreadsheets";
const file = (data: Uint8Array | string, name = "source.csv") =>
  new File([typeof data === "string" ? data : new Uint8Array(data)], name);
describe("safe knowledge source templates", () => {
  for (const t of templateLibrary)
    for (const format of ["csv", "xlsx"] as const) {
      it(`round-trips fictional ${t.id} ${format} with all source fields`, async () => {
        const source = await parseSource(
          file(await createTemplate(t.id, format, true), `source.${format}`),
        );
        expect(source.headers).toEqual(columns);
        const records = mapRecords(
          source.headers,
          source.rows,
          Object.fromEntries(columns.map((c) => [c, c])),
        );
        expect(records).toEqual(sampleRecords(t.id));
        expect(assessReadiness(records, [], "2026-11-03").ready).toBe(true);
      });
    }
  it("provides an instructions sheet and genuinely blank sample data", async () => {
    const w = new ExcelJS.Workbook();
    await w.xlsx.load((await createTemplate("general", "xlsx", false)) as never);
    expect(w.getWorksheet("Instructions")!.rowCount).toBeGreaterThan(6);
    expect(w.getWorksheet("Sample Data")!.rowCount).toBe(1);
    await expect(parseSource(file(await createTemplate("general", "csv", false)))).rejects.toThrow(
      /filled/,
    );
  });
  it("requires a known template", async () => {
    await expect(createTemplate("../private", "csv", true)).rejects.toThrow();
  });
});
describe("bounded untrusted source parsing", () => {
  it("handles quoted commas, newlines and escaped quotes", async () => {
    const result = await parseSource(
      file(
        'Topic,Category,Knowledge Content\r\n"A topic",Test,"A long record, with a newline\nand ""quoted"" text."\r\n',
      ),
    );
    expect(result.rows[0][2]).toContain('\nand "quoted" text.');
  });
  for (const value of [
    '=HYPERLINK("https://invalid.test")',
    "  +SUM(1,2)",
    "@SUM(1)",
    "-2+3",
    "\t=1+1",
  ])
    it(`rejects formula-like CSV cells ${JSON.stringify(value)}`, async () => {
      const cell = '"' + value.replaceAll('"', '""') + '"';
      await expect(
        parseSource(
          file(
            `Topic,Category,Knowledge Content\n${cell},General,Some sufficiently long content for a record.`,
          ),
        ),
      ).rejects.toThrow();
    });
  it("rejects formula cells in XLSX without trusting cached results", async () => {
    const w = new ExcelJS.Workbook(),
      s = w.addWorksheet("Sample Data");
    s.addRow(["Topic", "Category", "Knowledge Content"]);
    s.addRow([
      { formula: "1+1", result: 2 },
      "General",
      "Some sufficiently long content for a record.",
    ]);
    await expect(
      parseSource(file(new Uint8Array(await w.xlsx.writeBuffer()), "bad.xlsx")),
    ).rejects.toThrow(/Formulas/);
  });
  it("rejects unsupported files, malformed workbooks, binary CSV and invalid UTF-8", async () => {
    for (const bad of [
      file("document", "test.pdf"),
      file("not a zip", "test.xlsx"),
      file("a,b\n\0,c"),
      file(new Uint8Array([255, 254, 253])),
    ])
      await expect(parseSource(bad)).rejects.toThrow();
  });
  it("rejects oversized files, rows, headers and cells", async () => {
    const bad = [
      file("x".repeat(MAX_FILE_BYTES + 1)),
      file("A,B\n" + "a,b\n".repeat(201)),
      file("A,A\na,b"),
      file("A,B\na,b,c"),
      file(`A\n${"x".repeat(12001)}`),
    ];
    for (const f of bad) await expect(parseSource(f)).rejects.toThrow();
  });
  it("rejects ZIP expansion attacks before parsing workbook XML", async () => {
    const bomb = zipSync({ "xl/workbook.xml": new Uint8Array(5 * 1024 * 1024) });
    await expect(parseSource(file(bomb, "bomb.xlsx"))).rejects.toThrow(/unsafe|large/);
  });
  it("bounds actual ZIP expansion even when declared sizes are forged", async () => {
    const bomb = zipSync({ "xl/workbook.xml": new Uint8Array(5 * 1024 * 1024) });
    const view = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
    for (let i = 0; i < bomb.length - 28; i++) {
      if (view.getUint32(i, true) === 0x04034b50) view.setUint32(i + 22, 32, true);
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 32, true);
    }
    await expect(parseSource(file(bomb, "forged.xlsx"))).rejects.toThrow(/unsafe|large/);
  });
  it("rejects XML entities and external relationships", async () => {
    for (const xml of [
      '<!DOCTYPE test [<!ENTITY x "hello">]>',
      '<Relationship TargetMode="External" />',
    ]) {
      const zip = zipSync({
        "[Content_Types].xml": strToU8("<Types/>"),
        "xl/workbook.xml": strToU8(xml),
      });
      await expect(parseSource(file(zip, "unsafe.xlsx"))).rejects.toThrow(/External|entities/);
    }
  });
});
describe("deterministic readiness and curriculum", () => {
  const record = sampleRecord("product");
  it("reports duplicates and conflicts inside a source and against the organization", () => {
    const changed = {
      ...record,
      "Knowledge Content": "Changed content requiring a review before the import is approved.",
    };
    expect(assessReadiness([record, record, changed]).duplicates).toBe(1);
    expect(assessReadiness([record, changed]).conflicts).toBe(1);
    expect(assessReadiness([record], [{ fields: record, knowledge_id: "sample" }]).ready).toBe(
      false,
    );
    expect(
      assessReadiness(
        [{ ...record, Topic: `  ${record.Topic.toUpperCase()}  ` }],
        [{ fields: record, knowledge_id: "sample" }],
      ).duplicates,
    ).toBe(1);
  });
  it("flags missing sources, dates, owners, incomplete content and incomplete assessments without inventing facts", () => {
    const r = {
      ...record,
      "Source Reference": "",
      "Last Reviewed": "",
      "Content Owner": "",
      "Knowledge Content": "short",
      "Correct Answer": "unknown",
    };
    const result = assessReadiness([r]);
    expect(result).toMatchObject({
      missingSources: 1,
      incomplete: 1,
      review: 1,
      assessments: 0,
      ready: false,
    });
    expect(r["Source Reference"]).toBe("");
  });
  it("rejects impossible dates and repeated mappings", () => {
    expect(assessReadiness([{ ...record, "Effective Date": "2026-02-30" }]).ready).toBe(false);
    expect(() => mapRecords(["A"], [["value"]], { Topic: "A", Category: "A" })).toThrow(/once/);
    expect(() => mapRecords([], [], {})).toThrow();
  });
  it("creates a source-linked preview by copying approved material without synthesizing facts", () => {
    const preview = curriculumPreview([{ id: "source-1", version: 2, fields: record }]);
    expect(preview[0].lessons[0]).toMatchObject({
      content: record["Knowledge Content"],
      answer: record["Correct Answer"],
      id: "source-1",
      version: 2,
      source: record["Source Reference"],
    });
    expect(curriculumPreview([])).toEqual([]);
  });
});
