import { columns, type Column, type SourceRecord } from "./templates";
import { fail } from "./diagnostics";
export const requiredColumns: Column[] = ["Topic", "Category", "Knowledge Content"];
export function suggestMappings(headers: string[]) {
  const key = (s: string) => normalize(s).replace(/[^a-z0-9]/g, "");
  const aliases: Partial<Record<Column, string[]>> = {
    Topic: ["title", "subject"],
    Category: ["group", "department"],
    "Knowledge Content": ["content", "body", "description"],
    "Source Reference": ["source", "reference"],
  };
  return Object.fromEntries(
    columns.map((c) => [
      c,
      headers.find((h) => key(h) === key(c) || aliases[c]?.includes(key(h))) ?? "",
    ]),
  ) as Partial<Record<Column, string>>;
}
export const MAX_ROWS = 200;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const normalize = (value: string) => value.trim().replace(/\s+/gu, " ").toLowerCase();
export const recordKey = (r: SourceRecord) =>
  [r.Category, r.Topic, r.Subtopic].map(normalize).join("\u001f");
export const recordContent = (r: SourceRecord) =>
  columns
    .map((c) =>
      ["Topic", "Category", "Subtopic"].includes(c)
        ? normalize(r[c])
        : r[c].trim().normalize("NFC"),
    )
    .join("\u001f");
export const unsafeCell = (v: string) =>
  (/^[\s\uFEFF]*[=+@\-]/u.test(v) &&
    !/^\s*[+-]?[$€£¥]?\d[\d,]*(?:\.\d+)?%?\s*$/u.test(v) &&
    (!/^\s*-\s+\p{L}/u.test(v) || /^\s*-\s*[A-Za-z._]+\s*\(/u.test(v))) ||
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v);
export type ExistingSource = { fields: SourceRecord; knowledge_id: string };
export type Readiness = ReturnType<typeof assessReadiness>;
export function mapRecords(
  headers: string[],
  rows: string[][],
  mapping: Partial<Record<Column, string>>,
) {
  if (!rows.length || rows.length > MAX_ROWS)
    throw new Error("Use between 1 and 200 knowledge records.");
  const selected = Object.values(mapping).filter(Boolean);
  if (new Set(selected).size !== selected.length)
    fail("MAPPING", "Map each source column only once.");
  for (const c of requiredColumns)
    if (!mapping[c] || !headers.includes(mapping[c]!))
      fail("MAPPING", `Map the required ${c} field to an existing source column.`, { column: c });
  for (const c of columns)
    if (mapping[c] && !headers.includes(mapping[c]!))
      fail("MAPPING", `The selected source column for ${c} does not exist.`, { column: c });
  return rows.map(
    (row) =>
      Object.fromEntries(
        columns.map((c) => {
          const index = headers.indexOf(mapping[c] ?? "");
          return [c, index < 0 ? "" : (row[index] ?? "").trim().normalize("NFC")];
        }),
      ) as SourceRecord,
  );
}
export function assessReadiness(
  records: SourceRecord[],
  existing: ExistingSource[] = [],
  today = new Date().toISOString().slice(0, 10),
  rowNumbers?: number[],
  purpose: "import" | "academy" = "import",
) {
  const seen = new Map<string, string[]>();
  for (const e of existing) {
    const k = recordKey(e.fields);
    seen.set(k, [...(seen.get(k) ?? []), recordContent(e.fields)]);
  }
  const issues = records.map((r, i) => {
    const errors: string[] = [],
      warnings: string[] = [];
    if (r.Topic.length < 3 || r.Topic.length > 160)
      errors.push("Topic must contain 3–160 characters.");
    if (!r.Category || r.Category.length > 160)
      errors.push("Category is required (maximum 160 characters).");
    if (r.Subtopic.length > 160) errors.push("Subtopic must contain at most 160 characters.");
    if (r["Knowledge Content"].length < 20 || r["Knowledge Content"].length > 12000)
      errors.push("Knowledge Content must contain 20–12,000 characters.");
    for (const c of columns) {
      if (r[c].length > 12000 || unsafeCell(r[c]))
        errors.push(`${c}: remove formulas, control characters or oversized content.`);
    }
    for (const c of ["Effective Date", "Last Reviewed"] as const) {
      if (
        r[c] &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(r[c]) ||
          !Number.isFinite(Date.parse(r[c])) ||
          new Date(r[c]).toISOString().slice(0, 10) !== r[c])
      )
        errors.push(`${c}: use a valid YYYY-MM-DD date.`);
    }
    if (r.Difficulty && !["Beginner", "Intermediate", "Advanced"].includes(r.Difficulty))
      errors.push("Choose Beginner, Intermediate or Advanced difficulty.");
    const options = r["Answer Options"]
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    if (r["Assessment Question"] && (options.length < 2 || !options.includes(r["Correct Answer"])))
      warnings.push(
        "Assessment material needs at least two options and a matching correct answer.",
      );
    if (!r["Source Reference"]) warnings.push("Source reference missing.");
    if (!r["Learning Objective"] || !r["Content Owner"])
      warnings.push("Add a learning objective and content owner.");
    if (
      !r["Last Reviewed"] ||
      r["Last Reviewed"] < `${Number(today.slice(0, 4)) - 1}${today.slice(4)}` ||
      r["Last Reviewed"] > today ||
      r["Effective Date"] > today
    )
      warnings.push(
        "Review date is missing, stale or in the future, or content is not yet effective.",
      );
    const key = recordKey(r),
      content = recordContent(r),
      previous = seen.get(key);
    const duplicate = previous?.includes(content) ?? false,
      conflict = previous !== undefined && !duplicate;
    if (duplicate)
      errors.push(
        "Potential duplicate: this category, topic and subtopic already have the same record.",
      );
    if (conflict && purpose === "import")
      warnings.push(
        "Similar topic with different content: review these facts together. They may be imported as separate drafts; no existing record will be overwritten.",
      );
    seen.set(key, [...(previous ?? []), content]);
    return { row: rowNumbers?.[i] ?? i + 2, errors, warnings, duplicate, conflict };
  });
  return {
    total: records.length,
    categories: [...new Set(records.map((r) => r.Category).filter(Boolean))],
    topics: [...new Set(records.map((r) => r.Topic).filter(Boolean))],
    subtopics: [...new Set(records.map((r) => r.Subtopic).filter(Boolean))],
    missingSources: records.filter((r) => !r["Source Reference"]).length,
    incomplete: issues.filter((r) => r.errors.length).length,
    duplicates: issues.filter((r) => r.duplicate).length,
    conflicts: issues.filter((r) => r.conflict).length,
    review: issues.filter((r) => r.warnings.length).length,
    assessments: records.filter(
      (r) =>
        r["Assessment Question"] &&
        r["Answer Options"]
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean).length >= 2 &&
        r["Answer Options"]
          .split("|")
          .map((s) => s.trim())
          .includes(r["Correct Answer"]),
    ).length,
    issues,
    ready:
      records.length > 0 && records.length <= MAX_ROWS && issues.every((r) => !r.errors.length),
  };
}
export type CurriculumSource = { id: string; version: number; fields: SourceRecord };
export function curriculumPreview(sources: CurriculumSource[]) {
  return [...new Set(sources.map((s) => s.fields.Category))].map((category) => ({
    title: category,
    lessons: sources
      .filter((s) => s.fields.Category === category)
      .map((s) => ({
        title: s.fields.Topic,
        objective:
          s.fields["Learning Objective"] || "Missing objective — administrator review required.",
        content: s.fields["Knowledge Content"],
        scenario: s.fields["Example Scenario"],
        question: s.fields["Assessment Question"],
        options: s.fields["Answer Options"],
        answer: s.fields["Correct Answer"],
        source: s.fields["Source Reference"] || "Source reference missing — review required.",
        id: s.id,
        version: s.version,
      })),
  }));
}

export function assessAcademyReadiness(records: SourceRecord[]) {
  const result = assessReadiness(records, [], undefined, undefined, "academy");
  return { ...result, ready: result.ready && result.review === 0 };
}
