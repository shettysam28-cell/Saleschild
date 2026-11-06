import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  MAX_FILE_BYTES,
  MAX_ROWS,
  MAX_COLUMNS,
  MAX_REVIEW_ROWS,
  GATEWAY_ACCEPT,
  GATEWAY_FORMATS,
  uploadIssue,
} from "@/lib/knowledge/upload-contract";
import { MAX_ROWS as legacyRows, MAX_FILE_BYTES as legacyBytes } from "@/lib/knowledge/readiness";
import { defaultChoices, reviewRows } from "@/lib/knowledge/gateway-model";
import { extractGateway } from "@/lib/knowledge/gateway-extraction";
describe("shared knowledge upload contract", () => {
  it("shares the exact limits with the existing importer and accepts only supported formats", () => {
    expect([MAX_FILE_BYTES, MAX_ROWS, MAX_COLUMNS]).toEqual([2097152, 200, 32]);
    expect([legacyRows, legacyBytes]).toEqual([MAX_ROWS, MAX_FILE_BYTES]);
    expect(GATEWAY_ACCEPT).toBe(".csv,.xlsx,.docx");
    expect(GATEWAY_FORMATS).not.toContain("pdf");
    expect(uploadIssue({ name: "fixture.XLSX", size: MAX_FILE_BYTES })).toBeUndefined();
    expect(uploadIssue({ name: "fixture.csv", size: MAX_FILE_BYTES + 1 })).toContain("2 MiB");
    expect(uploadIssue({ name: "fixture.csv", size: 0 })).toContain("non-empty");
    expect(uploadIssue({ name: "fixture.pdf", size: 10 })).toContain("not supported");
  });
  it("preserves bounded review headroom without rejecting 200 records after an introductory row", async () => {
    const header = "Topic,Content\n";
    const records = Array.from(
      { length: MAX_ROWS },
      (_, i) => `Fictional lesson ${i},A documented fictional instruction for training.`,
    ).join("\n");
    const accepted = await extractGateway(
      new File(["Company training introduction\n" + header + records], "boundary.csv"),
    );
    const result = reviewRows(accepted, { ...defaultChoices(accepted), headerRow: 2 });
    expect(result).toHaveLength(MAX_ROWS);
    expect(result.every((row) => !row.errors.length)).toBe(true);
    const oversized = Array.from(
      { length: MAX_REVIEW_ROWS + 1 },
      (_, i) => `Fictional lesson ${i},A documented fictional instruction.`,
    ).join("\n");
    await expect(extractGateway(new File([header + oversized], "overflow.csv"))).rejects.toThrow(
      /250/,
    );
  });
  it("enforces the same column limit in actual server parsing", async () => {
    const csv =
      Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `Field ${i}`).join(",") +
      "\n" +
      Array.from({ length: MAX_COLUMNS + 1 }, () => "Fictional value").join(",");
    await expect(extractGateway(new File([csv], "columns.csv"))).rejects.toThrow(/32/);
  });
});
