import "server-only";
import { extractSpreadsheet } from "./spreadsheet-extraction";
import { extractDocx } from "./docx";
import { fail } from "./diagnostics";
import { MAX_FILE_BYTES } from "./readiness";
import type { GatewayExtraction } from "./gateway-model";
export async function extractGateway(file: File): Promise<GatewayExtraction> {
  if (!file.size) fail("EMPTY_FILE", "Choose a non-empty CSV, XLSX or DOCX source.");
  if (file.size > MAX_FILE_BYTES) fail("FILE_LIMIT", "Choose a file no larger than 2 MiB.");
  const format = file.name.split(".").at(-1)?.toLowerCase();
  if (!["csv", "xlsx", "docx"].includes(format ?? ""))
    fail(
      "FILE_TYPE",
      "Choose CSV, XLSX or DOCX. PowerPoint, PDF, DOC and image extraction are not supported.",
    );
  let result: GatewayExtraction;
  if (format === "docx") {
    const doc = extractDocx(new Uint8Array(await file.arrayBuffer()));
    result = {
      name: file.name.replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 120),
      format,
      sheets: [doc.sheet],
      origins: doc.origins,
      warnings: doc.warnings,
    };
  } else
    result = {
      ...(await extractSpreadsheet(file)),
      format: format as "csv" | "xlsx",
      warnings: [],
    };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 2500000)
    fail(
      "EXTRACTION_LIMIT",
      "The extracted knowledge exceeds 2.5 MB. Split it into smaller sources.",
    );
  return result;
}
