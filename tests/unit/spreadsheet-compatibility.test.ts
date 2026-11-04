import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { parseSource, createTemplate } from "@/lib/knowledge/spreadsheets";
import { assessReadiness, mapRecords, suggestMappings } from "@/lib/knowledge/readiness";
for (const name of ["openpyxl-inline.xlsx", "shared-prefixed.xlsx"])
  it(`independent generator/structure: ${name}`, async () => {
    const file = new File(
      [new Uint8Array(await readFile("tests/fixtures/spreadsheets/" + name))],
      name,
    );
    const parsed = await parseSource(file, "Knowledge Records");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0][0]).toBe("設備の点検 🧰");
    expect(parsed.rows[0][14]).toBe("2026-01-01");
    expect(parsed.rowNumbers).toEqual([2]);
    expect(parsed.worksheets).toHaveLength(4);
    expect(
      assessReadiness(mapRecords(parsed.headers, parsed.rows, suggestMappings(parsed.headers)))
        .ready,
    ).toBe(true);
    expect((await parseSource(file, "Second source")).rows[0][0]).toBe("Another fictional topic");
    await expect(parseSource(file, "Summary")).rejects.toMatchObject({
      diagnostic: { code: "FORMULA", worksheet: "Summary", row: 1, column: "A1" },
    });
  });
it("native template survives common rich text, hyperlink, date and styled-empty-row edits", async () => {
  const w = new ExcelJS.Workbook();
  await w.xlsx.load((await createTemplate("product", "xlsx", true)) as never);
  const s = w.getWorksheet("Sample Data")!;
  s.getCell("A2").value = {
    richText: [{ text: "Fictional " }, { text: "rich title", font: { bold: true } }],
  };
  s.getCell("N2").value = {
    text: "https://example.test/source",
    hyperlink: "https://example.test/source",
  };
  s.getCell("O2").value = new Date("2026-01-01T00:00:00Z");
  s.getCell("A2000").font = { bold: true };
  const parsed = await parseSource(
    new File([new Uint8Array(await w.xlsx.writeBuffer())], "edited.xlsx"),
  );
  expect(parsed.rows).toHaveLength(2);
  expect(parsed.rows[0][0]).toBe("Fictional rich title");
  expect(parsed.rows[0][14]).toBe("2026-01-01");
});
for (const ending of ["\n", "\r\n", "\r"])
  it(`CSV BOM, Unicode, quoted multiline and empty cells ${JSON.stringify(ending)}`, async () => {
    const text =
      "\uFEFFTopic,Category,Knowledge Content,Source Reference" +
      ending +
      '"A Unicode 🧰 topic",General,"A long content value, with a quoted ""example""' +
      ending +
      'and another line",' +
      ending +
      ending;
    const parsed = await parseSource(new File([text], "input.csv"));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0][2]).toContain('"example"');
    expect(parsed.rows[0][3]).toBe("");
    expect(parsed.rowNumbers).toEqual([2]);
  });
it("reports missing required mappings and accepts optional omissions for draft readiness", async () => {
  expect(() => mapRecords(["Title"], [["value"]], { Topic: "Title" })).toThrow(/Category/);
  const records = mapRecords(
    ["Title", "Group", "Body"],
    [["A valid title", "General", "Content that has at least twenty characters."]],
    suggestMappings(["Title", "Group", "Body"]),
  );
  expect(assessReadiness(records)).toMatchObject({ ready: true, missingSources: 1, review: 1 });
});
it("distinct facts under the same topic are draft-ready; exact repeats are not", async () => {
  const { sampleRecord } = await import("@/lib/knowledge/templates");
  const first = sampleRecord("general");
  const second = {
    ...first,
    "Knowledge Content":
      "A different and independently useful knowledge fact under the same topic.",
  };
  expect(assessReadiness([first, second])).toMatchObject({
    ready: true,
    duplicates: 0,
    conflicts: 1,
  });
  expect(assessReadiness([first, first])).toMatchObject({ ready: false, duplicates: 1 });
});
it("formatted numeric values retain percent, currency and zero-padding meaning", async () => {
  const w = new ExcelJS.Workbook(),
    s = w.addWorksheet("Values");
  s.addRow(["Percent", "Currency", "Code"]);
  s.addRow([0.125, 1234.5, 42]);
  s.getCell("A2").numFmt = "0.0%";
  s.getCell("B2").numFmt = "$#,##0.00";
  s.getCell("C2").numFmt = "00000";
  const parsed = await parseSource(
    new File([new Uint8Array(await w.xlsx.writeBuffer())], "formats.xlsx"),
  );
  expect(parsed.rows[0]).toEqual(["12.5%", "$1,234.50", "00042"]);
});
it("treats technical words and safe hyperlink labels as data, never workbook instructions", async () => {
  const w = new ExcelJS.Workbook(),
    s = w.addWorksheet("Data");
  s.addRow(["Topic", "Category", "Knowledge Content", "Content Owner"]);
  s.addRow([
    "Technical metadata",
    "Training",
    "The macroEnabled and oleObject words are literal fictional training content.",
    { text: "training@example.test", hyperlink: "mailto:training@example.test" },
  ]);
  const parsed = await parseSource(
    new File([new Uint8Array(await w.xlsx.writeBuffer())], "technical.xlsx"),
  );
  expect(parsed.rows[0][2]).toContain("macroEnabled");
  expect(parsed.rows[0][3]).toBe("training@example.test");
});
it("rejects actual macro content types and embedded-object nodes without keyword false positives", async () => {
  for (const macro of [true, false]) {
    const entries = unzipSync(await createTemplate("product", "xlsx", true));
    const path = macro ? "[Content_Types].xml" : "xl/worksheets/sheet2.xml";
    const xml = strFromU8(entries[path]);
    entries[path] = strToU8(
      macro
        ? xml.replace(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
            "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
          )
        : xml.replace("</worksheet>", "<oleObjects/></worksheet>"),
    );
    await expect(
      parseSource(new File([new Uint8Array(zipSync(entries))], "unsafe.xlsx")),
    ).rejects.toMatchObject({ diagnostic: { code: "UNSAFE_WORKBOOK" } });
  }
});
it("accepts exactly 200 records and reports the first record beyond the limit", async () => {
  const header = "Topic,Category,Knowledge Content\n";
  const rows = Array.from(
    { length: 200 },
    (_, i) => `Topic ${i},General,A sufficiently long fictional knowledge record ${i}.`,
  ).join("\n");
  expect((await parseSource(new File([header + rows], "boundary.csv"))).rows).toHaveLength(200);
  await expect(
    parseSource(
      new File(
        [
          header +
            rows +
            "\nExtra topic,General,An extra fictional knowledge record beyond the limit.",
        ],
        "too-many.csv",
      ),
    ),
  ).rejects.toMatchObject({ diagnostic: { code: "ROW_LIMIT", row: 202 } });
});
it("distinguishes corrupt, unsupported, missing-sheet and invalid-column diagnostics", async () => {
  await expect(parseSource(new File(["not xlsx"], "broken.xlsx"))).rejects.toMatchObject({
    diagnostic: { code: "CORRUPT_FILE" },
  });
  await expect(parseSource(new File(["text"], "file.xls"))).rejects.toMatchObject({
    diagnostic: { code: "FILE_TYPE" },
  });
  await expect(
    parseSource(
      new File(
        [new Uint8Array(await readFile("tests/fixtures/spreadsheets/openpyxl-inline.xlsx"))],
        "sheets.xlsx",
      ),
      "Missing",
    ),
  ).rejects.toMatchObject({ diagnostic: { code: "WORKSHEET" } });
  await expect(
    parseSource(new File(["Topic,topic\nOne,Two"], "headers.csv")),
  ).rejects.toMatchObject({ diagnostic: { code: "HEADERS", row: 1, column: "2" } });
});
