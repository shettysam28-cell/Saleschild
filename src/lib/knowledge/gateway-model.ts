import type { SpreadsheetExtraction } from "./spreadsheet-extraction";
import type { DocumentBlock } from "./docx";
export type GatewayField = { id: string; label: string; value: string };
export type GatewayExtraction = SpreadsheetExtraction & {
  format: "csv" | "xlsx" | "docx";
  warnings: string[];
  origins?: Record<string, DocumentBlock[]>;
};
export type ReviewChoices = {
  sheet: number;
  headerRow: number;
  titleColumn: string;
  labels: string[];
  edits: Record<
    string,
    { title?: string; values?: Record<string, string>; excluded?: boolean; confirmed?: boolean }
  >;
};
export type DuplicateMatch = { id: string; title: string; excerpt: string };
export type DuplicateResult = { key: string; exact: DuplicateMatch[]; possible: DuplicateMatch[] };
export type GatewayRow = {
  key: string;
  row: number;
  title: string;
  fields: GatewayField[];
  originalFields: GatewayField[];
  excluded: boolean;
  confirmed: boolean;
  errors: string[];
  exact: DuplicateMatch[];
  possible: DuplicateMatch[];
  source: { worksheet: string; headerRow: number; row: number; documentBlocks?: DocumentBlock[] };
};
export type GatewayUpload = {
  id: string;
  source_name: string;
  extraction: GatewayExtraction;
  choices: ReviewChoices;
  revision: number;
  expires_at: string;
  saved_ids: string[] | null;
};
export const defaultChoices = (extraction: GatewayExtraction): ReviewChoices => {
  const index = Math.max(
    0,
    extraction.sheets.findIndex(
      (s) =>
        !s.issue &&
        s.rows.some((r) => r.cells.some((v) => v.trim())) &&
        s.name.toLowerCase() !== "instructions",
    ),
  );
  return {
    sheet: index,
    headerRow: extraction.sheets[index]?.rows.find((r) => r.cells.some((v) => v.trim()))?.row ?? 0,
    titleColumn: "",
    labels: [],
    edits: {},
  };
};
export function fieldBody(fields: GatewayField[]) {
  return fields
    .filter((f) => f.value.trim())
    .map((f) => `${f.label}: ${f.value}`)
    .join("\n\n");
}
export function fieldIdentity(fields: GatewayField[]) {
  return JSON.stringify(
    fields
      .map((f) => [f.label.trim().normalize("NFC").toLowerCase(), f.value.trim().normalize("NFC")])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}
export function reviewRows(
  extraction: GatewayExtraction,
  choices: ReviewChoices,
  duplicates: DuplicateResult[] = [],
): GatewayRow[] {
  const sheet = extraction.sheets[choices.sheet];
  if (!sheet || sheet.issue) return [];
  const populated = sheet.rows.filter((r) => r.cells.some((v) => v.trim()));
  const header =
    choices.headerRow === 0 ? undefined : populated.find((r) => r.row === choices.headerRow);
  const data = populated.filter((r) => !header || r.row > header.row);
  const width = Math.min(
    32,
    Math.max(header?.cells.length ?? 0, ...data.map((r) => r.cells.length), 0),
  );
  const originalLabels = Array.from(
    { length: width },
    (_, i) => header?.cells[i]?.trim() || `Column ${i + 1}`,
  );
  const labels = originalLabels.map((label, i) => choices.labels[i] ?? label);
  const suggested = originalLabels.findIndex((l) =>
    /^(topic|title|subject|name|question|procedure|product|section)$/iu.test(l.trim()),
  );
  const titleIndex = choices.titleColumn
    ? Number(choices.titleColumn.slice(1)) - 1
    : Math.max(0, suggested);
  const seen = new Map<string, string>();
  const titles = new Map<string, DuplicateMatch>();
  return data.map((raw) => {
    const key = `${choices.sheet}:${raw.row}`,
      edit = choices.edits[key];
    const originalFields = originalLabels.map((label, i) => ({
      id: `c${i + 1}`,
      label,
      value: (raw.cells[i] ?? "").normalize("NFC"),
    }));
    const fields = originalFields.map((f, i) => ({
      ...f,
      label: labels[i].normalize("NFC"),
      value: (edit?.values?.[f.id] ?? f.value).normalize("NFC"),
    }));
    const suggestedTitle = fields[titleIndex]?.value.trim() ?? "";
    const title = (
      edit?.title ??
      (suggestedTitle.length >= 3 && suggestedTitle.length <= 160
        ? suggestedTitle
        : `${sheet.name} · row ${raw.row}`)
    ).normalize("NFC");
    const errors: string[] = [];
    if (title.length < 3 || title.length > 160) errors.push("Use a title of 3–160 characters.");
    for (const f of fields) {
      if (!f.label.trim() || f.label.length > 100)
        errors.push(`${f.id}: add a column name of 1–100 characters.`);
      if (f.value.length > 12000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(f.value))
        errors.push(
          `${f.label}: remove control characters and keep the value within 12,000 characters.`,
        );
    }
    const body = fieldBody(fields);
    if (!fields.some((f) => f.value.trim()) || body.length < 20 || body.length > 20000)
      errors.push(
        "Add meaningful content: the combined labeled values must contain 20–20,000 characters.",
      );
    const result = duplicates.find((d) => d.key === key);
    const identity = fieldIdentity(fields),
      earlier = seen.get(identity);
    const exact = [
      ...(result?.exact ?? []),
      ...(earlier
        ? [
            {
              id: earlier,
              title: `Earlier source row ${earlier.split(":")[1]}`,
              excerpt: "The same column labels and values appear earlier in this upload.",
            },
          ]
        : []),
    ];
    if (!edit?.excluded && !earlier) seen.set(identity, key);
    const titleKey = title.trim().toLowerCase(),
      previousTitle = titles.get(titleKey);
    const possible = [
      ...(result?.possible ?? []),
      ...(!exact.length && previousTitle ? [previousTitle] : []),
    ];
    if (!edit?.excluded && !previousTitle)
      titles.set(titleKey, { id: key, title, excerpt: fieldBody(fields).slice(0, 1000) });
    return {
      key,
      row: raw.row,
      title,
      fields,
      originalFields,
      excluded: edit?.excluded ?? false,
      confirmed: edit?.confirmed ?? false,
      errors,
      exact,
      possible,
      source: {
        worksheet: sheet.name,
        headerRow: choices.headerRow,
        row: raw.row,
        ...(extraction.origins?.[String(raw.row)]
          ? { documentBlocks: extraction.origins[String(raw.row)] }
          : {}),
      },
    };
  });
}
