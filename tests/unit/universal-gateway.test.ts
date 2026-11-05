import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { extractGateway } from "@/lib/knowledge/gateway-extraction";
import {
  defaultChoices,
  reviewRows,
  fieldBody,
  fieldIdentity,
} from "@/lib/knowledge/gateway-model";
async function xlsx(rows: unknown[][]) {
  const w = new ExcelJS.Workbook();
  w.addWorksheet("Company handbook").addRows(rows);
  return new File([new Uint8Array(await w.xlsx.writeBuffer())], "company.xlsx");
}
async function doc() {
  return new File(
    [new Uint8Array(await readFile("tests/fixtures/documents/structured-guide.docx"))],
    "guide.docx",
  );
}
it("imports a three-column company structure without fixed template fields", async () => {
  const extracted = await extractGateway(
    await xlsx([
      ["Procedure", "Audience", "Local details"],
      [
        "Device setup",
        "New starters",
        "Inspect the fictional practice device before starting the training scenario.",
      ],
    ]),
  );
  const rows = reviewRows(extracted, defaultChoices(extracted));
  expect(rows).toHaveLength(1);
  expect(rows[0].errors).toEqual([]);
  expect(rows[0].fields.map((f) => f.label)).toEqual(["Procedure", "Audience", "Local details"]);
  expect(fieldBody(rows[0].fields)).toContain("Local details: Inspect");
});
it("allows intro-row override, preserves empty values and corrects missing/repeated headers", async () => {
  const extracted = await extractGateway(
    await xlsx([
      ["Fictional Company Knowledge"],
      [],
      ["Name", "Name", null, "Effective"],
      [
        "Device procedure",
        "Operations",
        "A company-defined instruction that does not require Category or Knowledge Content.",
        new Date("2026-01-01T00:00:00Z"),
      ],
    ]),
  );
  const choices = { ...defaultChoices(extracted), headerRow: 3 };
  const rows = reviewRows(extracted, choices);
  expect(rows[0].row).toBe(4);
  expect(rows[0].fields.map((f) => f.label)).toEqual(["Name", "Name", "Column 3", "Effective"]);
  expect(rows[0].fields[3].value).toBe("2026-01-01");
  choices.labels = ["Procedure", "Department", "Company practice", "Effective date"];
  expect(reviewRows(extracted, choices)[0].originalFields[1].label).toBe("Name");
  expect(reviewRows(extracted, choices)[0].fields[1].label).toBe("Department");
});
it("supports a source without headers and owner-selected title fields", async () => {
  const extracted = await extractGateway(
    await xlsx([
      [
        "Operations",
        "Device setup",
        "A long fictional company procedure with enough useful detail.",
      ],
    ]),
  );
  const rows = reviewRows(extracted, {
    ...defaultChoices(extracted),
    headerRow: 0,
    titleColumn: "c2",
  });
  expect(rows[0].title).toBe("Device setup");
  expect(rows[0].row).toBe(1);
  expect(rows[0].fields[0].label).toBe("Column 1");
});
for (const delimiter of [",", ";", "\t"])
  it(`CSV ${JSON.stringify(delimiter)} supports BOM, Unicode, multiline and line endings`, async () => {
    const csv =
      "\uFEFFProcedure" +
      delimiter +
      "Audience" +
      delimiter +
      'Description\r\n"Device setup"' +
      delimiter +
      '"Operations 🧰"' +
      delimiter +
      '"Line one, with a comma\r\nline two; with a semicolon and ""quotes""."\r\n';
    const extraction = await extractGateway(new File([csv], "company.csv"));
    const row = reviewRows(extraction, defaultChoices(extraction))[0];
    expect(row.fields).toHaveLength(3);
    expect(row.fields[2].value).toContain('"quotes"');
    expect(row.fields[1].value).toContain("🧰");
    expect(row.errors).toEqual([]);
  });
it("switches worksheets using one extraction, including a formula-only unsupported sheet", async () => {
  const w = new ExcelJS.Workbook();
  w.addWorksheet("Company rows").addRows([
    ["Title", "Detail"],
    ["Approved routine", "A fictional routine that a reviewer can edit before saving."],
  ]);
  w.addWorksheet("Summary").getCell("A1").value = { formula: "1+1", result: 2 };
  const extraction = await extractGateway(
    new File([new Uint8Array(await w.xlsx.writeBuffer())], "sheets.xlsx"),
  );
  expect(extraction.sheets[1].issue?.code).toBe("FORMULA");
  expect(reviewRows(extraction, defaultChoices(extraction))).toHaveLength(1);
  expect(reviewRows(extraction, { ...defaultChoices(extraction), sheet: 1 })).toEqual([]);
});
it("retains plain company text, never evaluates formula-like strings or markup", async () => {
  const extraction = await extractGateway(
    new File(
      [
        'Name,Detail\n"@support","<script>alert(1)</script> is literal training text, not executable markup."',
      ],
      "text.csv",
    ),
  );
  const rows = reviewRows(extraction, defaultChoices(extraction));
  expect(rows[0].fields[0].value).toBe("@support");
  expect(rows[0].fields[1].value).toContain("<script>");
});
it("detects exact repeats without equating separate facts under a shared topic", async () => {
  const e = await extractGateway(
    await xlsx([
      ["Topic", "Detail"],
      ["Safety", "Inspect the fictional indicator before starting a simulation."],
      ["Safety", "Pause the fictional device when its amber indicator appears."],
      ["Safety", "Inspect the fictional indicator before starting a simulation."],
    ]),
  );
  const rows = reviewRows(e, defaultChoices(e));
  expect(rows[1].exact).toEqual([]);
  expect(rows[2].exact).toHaveLength(1);
  expect(fieldIdentity([...rows[0].fields].reverse())).toBe(fieldIdentity(rows[0].fields));
});
it("preserves review typing, row exclusions, source coordinates and original values", async () => {
  const e = await extractGateway(
    await xlsx([
      ["Topic", "Detail"],
      ["Safety", "Inspect the fictional indicator before starting a simulation."],
    ]),
  );
  const c = {
    ...defaultChoices(e),
    edits: {
      "0:2": {
        title: "A new ",
        values: { c2: "A corrected value with a trailing " },
        excluded: true,
      },
    },
  };
  const row = reviewRows(e, c)[0];
  expect(row.title).toBe("A new ");
  expect(row.fields[1].value).toBe("A corrected value with a trailing ");
  expect(row.originalFields[1].value).toContain("Inspect");
  expect(row.excluded).toBe(true);
  expect(row.source.row).toBe(2);
});
it("extracts actual python-docx headings, paragraphs, lists and tables in order", async () => {
  const extraction = await extractGateway(await doc());
  const rows = reviewRows(extraction, defaultChoices(extraction));
  expect(extraction.format).toBe("docx");
  expect(rows).toHaveLength(2);
  expect(rows[0].title).toBe("Device preparation");
  expect(rows[1].title).toContain("Escalation");
  const blocks = rows[0].source.documentBlocks!;
  expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "table"]);
  expect(blocks[2].text).toContain("approved practice mode");
  expect(blocks[3].cells).toEqual([
    ["Check", "Owner"],
    ["Indicator 🧰", "Operations"],
  ]);
  expect(extraction.warnings.join(" ")).toContain("OCR is unavailable");
});
it("rejects external DOCX content, entity declarations, macros and embedded objects", async () => {
  const bytes = new Uint8Array(await (await doc()).arrayBuffer());
  for (const type of ["external", "entity", "macro", "object", "activeX"]) {
    const parts = unzipSync(bytes);
    if (type === "activeX") parts["word/activeX/activeX1.bin"] = new Uint8Array([1, 2, 3]);
    if (type === "external")
      parts["word/_rels/document.xml.rels"] = strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="unsafe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" TargetMode="External" Target="https://example.test/template"/></Relationships>',
      );
    if (type === "entity")
      parts["word/document.xml"] = strToU8(
        '<!DOCTYPE document [<!ENTITY source SYSTEM "file:///etc/passwd">]><document>&source;</document>',
      );
    if (type === "macro")
      parts["[Content_Types].xml"] = strToU8(
        strFromU8(parts["[Content_Types].xml"]).replace(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
          "application/vnd.ms-word.document.macroEnabled.main+xml",
        ),
      );
    if (type === "object")
      parts["word/document.xml"] = strToU8(
        strFromU8(parts["word/document.xml"]).replace("</w:body>", "<w:object/></w:body>"),
      );
    await expect(
      extractGateway(new File([new Uint8Array(zipSync(parts))], "unsafe.docx")),
    ).rejects.toThrow();
  }
});
it("rejects image-only DOCX instead of claiming OCR and reports unsupported/empty sources", async () => {
  const parts = unzipSync(new Uint8Array(await (await doc()).arrayBuffer()));
  parts["word/document.xml"] = strToU8(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:drawing/></w:r></w:p></w:body></w:document>',
  );
  await expect(
    extractGateway(new File([new Uint8Array(zipSync(parts))], "scan.docx")),
  ).rejects.toMatchObject({ diagnostic: { code: "EMPTY_DOCUMENT" } });
  await expect(extractGateway(new File(["slides"], "slides.pptx"))).rejects.toMatchObject({
    diagnostic: { code: "FILE_TYPE" },
  });
  await expect(extractGateway(new File([], "empty.csv"))).rejects.toMatchObject({
    diagnostic: { code: "EMPTY_FILE" },
  });
});

it("enforces physical CSV row limits even when most source rows are blank", async () => {
  await expect(
    extractGateway(
      new File(
        [
          "Topic,Details\n" +
            "\n".repeat(10000) +
            "A fictional topic,A sufficiently long fictional instruction for row limits.",
        ],
        "sparse.csv",
      ),
    ),
  ).rejects.toMatchObject({ diagnostic: { code: "ROW_LIMIT" } });
});

it("reports physical CSV source rows correctly after skipped blank lines", async () => {
  const e = await extractGateway(
    new File(
      [
        'Title,Details\n\n\nA fictional topic,"A quoted instruction\nwith a second physical line of text."\n',
      ],
      "spaced.csv",
    ),
  );
  expect(reviewRows(e, defaultChoices(e))[0].source.row).toBe(4);
});

for (const format of ["csv", "xlsx"] as const) {
  it(`${format} default review excludes a BOM/blank-prefixed header and keeps source coordinates`, async () => {
    const rows = [
      ["Topic", "Category", "Knowledge Content"],
      ["Fictional training", "Operations", "Keep the documented fictional guidance intact."],
    ];
    const file =
      format === "xlsx"
        ? await xlsx([[], ...rows])
        : new File(["\uFEFF\n" + rows.map((row) => row.join(",")).join("\r\n")], "header.csv");
    const extracted = await extractGateway(file);
    const choices = defaultChoices(extracted);
    const result = reviewRows(extracted, choices);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Fictional training");
    expect(result[0].row).toBeGreaterThan(choices.headerRow);
    expect(result[0].errors).toEqual([]);
  });
  it(`${format} prevents a known template header being saved with No header row`, async () => {
    const data = [
      ["Topic", "Category", "Knowledge Content"],
      ["Fictional training", "Operations", "Keep the documented fictional guidance intact."],
    ];
    const file =
      format === "xlsx"
        ? await xlsx(data)
        : new File([data.map((row) => row.join(",")).join("\n")], "known-header.csv");
    const extracted = await extractGateway(file);
    const result = reviewRows(extracted, { ...defaultChoices(extracted), headerRow: 0 });
    expect(result[0].errors.join(" ")).toContain("column headings, not knowledge");
    expect(result[1].errors).toEqual([]);
  });
  it(`${format} treats header-only input as zero knowledge records`, async () => {
    const file =
      format === "xlsx"
        ? await xlsx([["Topic", "Category", "Knowledge Content"]])
        : new File(["Topic,Category,Knowledge Content\n"], "blank-template.csv");
    const extracted = await extractGateway(file);
    expect(reviewRows(extracted, defaultChoices(extracted))).toEqual([]);
  });
}
it("rejects repeated arbitrary mapped headers without hiding genuine ambiguous content", async () => {
  const extracted = await extractGateway(
    await xlsx([
      ["Procedure", "Company instruction"],
      ["Fictional setup", "Read this exact company-defined training instruction."],
      ["Procedure", "Company instruction"],
    ]),
  );
  const choices = defaultChoices(extracted);
  choices.labels = ["Local procedure title", "Local documented guidance"];
  const result = reviewRows(extracted, choices);
  expect(result[0].fields[0].label).toBe("Local procedure title");
  expect(result[0].originalFields[0].label).toBe("Procedure");
  expect(result[1].errors.join(" ")).toContain("column headings, not knowledge");
  const ambiguous = await extractGateway(
    await xlsx([["Topic", "This is genuine training content, not a heading."]]),
  );
  expect(reviewRows(ambiguous, { ...defaultChoices(ambiguous), headerRow: 0 })[0].errors).toEqual(
    [],
  );
});
