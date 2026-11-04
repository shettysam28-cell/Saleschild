import "server-only";
import { SaxesParser } from "saxes";
import { readOfficeArchive } from "./office-archive";
import { fail } from "./diagnostics";
import type { ExtractedSheet } from "./spreadsheet-extraction";

type Node = {
  name: string;
  uri: string;
  attrs: Record<string, string>;
  children: (Node | string)[];
};
export type DocumentBlock = {
  kind: "heading" | "paragraph" | "list" | "table";
  text: string;
  level?: number;
  cells?: string[][];
};
const word = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);
function xmlTree(bytes: Uint8Array) {
  const parser = new SaxesParser({ xmlns: true });
  const stack: Node[] = [];
  let root: Node | undefined,
    count = 0;
  parser.on("doctype", () =>
    fail("UNSAFE_DOCUMENT", "Document types and XML entities are not supported."),
  );
  parser.on("opentag", (tag) => {
    if (++count > 25000 || stack.length > 64)
      fail(
        "DOCUMENT_LIMIT",
        "Simplify this document: its XML structure is too large or deeply nested.",
      );
    const attrs = Object.fromEntries(Object.values(tag.attributes).map((a) => [a.local, a.value]));
    if (
      /^(object|oleObject|control|altChunk|fldSimple|instrText|del|ins)$/i.test(tag.local) ||
      /macroEnabled|vbaProject/iu.test(attrs.ContentType ?? "")
    )
      fail(
        "UNSAFE_DOCUMENT",
        "Remove embedded objects, fields, tracked changes and macros before uploading a standard DOCX copy.",
      );
    if (
      tag.local === "Relationship" &&
      attrs.TargetMode === "External" &&
      (!attrs.Type?.endsWith("/hyperlink") || !/^(https?:|mailto:|#)/iu.test(attrs.Target ?? ""))
    )
      fail(
        "EXTERNAL_REFERENCE",
        "Remove external document links, attached templates and remote content. Ordinary web/email hyperlinks are read as text only.",
      );
    const node: Node = { name: tag.local, uri: tag.uri, attrs, children: [] };
    if (stack.length) stack.at(-1)!.children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on("text", (text) => stack.at(-1)?.children.push(text));
  parser.on("cdata", (text) => stack.at(-1)?.children.push(text));
  parser.on("closetag", () => stack.pop());
  try {
    parser.write(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).close();
  } catch (error) {
    if (error instanceof Error && "diagnostic" in error) throw error;
    fail("CORRUPT_DOCX", "The document XML is malformed. Save a fresh DOCX copy.");
  }
  if (!root) fail("CORRUPT_DOCX", "The document has no readable XML body.");
  return root;
}
const nodes = (n: Node) => n.children.filter((c): c is Node => typeof c !== "string");
function descendants(n: Node, name: string): Node[] {
  return nodes(n).flatMap((c) => [
    ...(c.name === name && word.has(c.uri) ? [c] : []),
    ...descendants(c, name),
  ]);
}
function text(n: Node): string {
  if (!word.has(n.uri)) return nodes(n).map(text).join("");
  if (n.name === "t") return n.children.filter((c) => typeof c === "string").join("");
  if (n.name === "tab") return "\t";
  if (["br", "cr"].includes(n.name)) return "\n";
  return nodes(n).map(text).join("");
}
export function extractDocx(bytes: Uint8Array): {
  sheet: ExtractedSheet;
  blocks: DocumentBlock[];
  origins: Record<string, DocumentBlock[]>;
  warnings: string[];
} {
  let entries: Record<string, Uint8Array>;
  try {
    entries = readOfficeArchive(bytes);
  } catch {
    fail(
      "WORKBOOK_STRUCTURE",
      "This DOCX archive is unsafe, incomplete or exceeds the safe expansion limit.",
    );
  }
  if (!entries["[Content_Types].xml"] || !entries["word/document.xml"])
    fail("CORRUPT_DOCX", "Choose a valid Word DOCX document, not DOC, PDF or a renamed archive.");
  const trees: Record<string, Node> = {};
  for (const [name, data] of Object.entries(entries))
    if (/\.(xml|rels)$/i.test(name)) trees[name] = xmlTree(data);
  const document = trees["word/document.xml"];
  const body = descendants(document, "body")[0];
  if (!body) fail("CORRUPT_DOCX", "The Word document has no supported document body.");
  const styles = new Map<string, number>();
  if (trees["word/styles.xml"])
    for (const style of descendants(trees["word/styles.xml"], "style")) {
      const named = descendants(style, "name")[0]?.attrs.val ?? style.attrs.styleId;
      const outline = descendants(style, "outlineLvl")[0]?.attrs.val;
      const level =
        outline !== undefined
          ? Number(outline) + 1
          : Number(/heading\s*([1-9])/i.exec(named ?? "")?.[1]);
      if (level >= 1 && level <= 9) styles.set(style.attrs.styleId, level);
    }
  const blocks: DocumentBlock[] = [];
  function paragraph(p: Node) {
    const value = text(p).trim().normalize("NFC");
    if (!value) return;
    const style = descendants(p, "pStyle")[0]?.attrs.val ?? "";
    const outline = descendants(p, "outlineLvl")[0]?.attrs.val;
    const level =
      outline !== undefined
        ? Number(outline) + 1
        : (styles.get(style) ?? Number(/^Heading([1-9])$/i.exec(style)?.[1]));
    const list = descendants(p, "numPr").length > 0 || /^List/i.test(style);
    blocks.push(
      level >= 1 && level <= 9
        ? { kind: "heading", level, text: value }
        : { kind: list ? "list" : "paragraph", text: list ? "- " + value : value },
    );
  }
  function visit(n: Node) {
    if (n.name === "p" && word.has(n.uri)) paragraph(n);
    else if (n.name === "tbl" && word.has(n.uri)) {
      const rows = nodes(n)
        .filter((c) => c.name === "tr")
        .map((row) =>
          nodes(row)
            .filter((c) => c.name === "tc")
            .map((cell) => descendants(cell, "p").map(text).join("\n").trim()),
        );
      if (rows.some((r) => r.some(Boolean)))
        blocks.push({
          kind: "table",
          cells: rows,
          text: rows.map((r) => r.join(" | ")).join("\n"),
        });
    } else for (const child of nodes(n)) visit(child);
    if (blocks.length > 2000)
      fail(
        "DOCUMENT_LIMIT",
        "Split the document into smaller files (at most 2,000 text/table blocks).",
      );
  }
  visit(body);
  if (!blocks.length)
    fail(
      "EMPTY_DOCUMENT",
      "No document text was found. Images and scans are not OCR processed; add selectable text before uploading.",
    );
  const sections: { title: string; blocks: DocumentBlock[] }[] = [];
  const headings: string[] = [];
  let current = { title: "Document introduction", blocks: [] as DocumentBlock[] };
  for (const block of blocks) {
    if (block.kind === "heading") {
      if (current.blocks.some((b) => b.kind !== "heading")) sections.push(current);
      headings.length = (block.level ?? 1) - 1;
      headings.push(block.text);
      current = { title: headings.filter(Boolean).join(" / "), blocks: [block] };
    } else current.blocks.push(block);
  }
  if (current.blocks.some((b) => b.kind !== "heading")) sections.push(current);
  if (!sections.length)
    fail(
      "EMPTY_DOCUMENT",
      "This document contains headings only. Add text or tables beneath the headings.",
    );
  if (sections.length > 200)
    fail("ROW_LIMIT", "Split this document into files with no more than 200 sections.");
  const origins: Record<string, DocumentBlock[]> = {};
  const rows = [
    { row: 1, cells: ["Section", "Content"] },
    ...sections.map((s, i) => {
      origins[String(i + 2)] = s.blocks;
      const content = s.blocks
        .filter((b) => b.kind !== "heading")
        .map((b) => b.text)
        .join("\n\n");
      if (content.length > 12000)
        fail(
          "CELL_VALUE",
          "Split this document section into smaller headings (12,000 characters per section).",
          { row: i + 2, column: "Content" },
        );
      return { row: i + 2, cells: [s.title, content] };
    }),
  ];
  return {
    sheet: { name: "Document sections", rows },
    blocks,
    origins,
    warnings: [
      "Confirm the inferred section titles and order. Lists and tables retain text order, not Word page styling. Images, headers, footers and footnotes are not extracted; OCR is unavailable.",
    ],
  };
}
