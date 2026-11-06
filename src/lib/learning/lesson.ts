import type { ApprovedLearningSource } from "./curriculum";

const normalized = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const metadata = new Set([
  "topic",
  "category",
  "subtopic",
  "difficulty",
  "contentowner",
  "sourcereference",
  "effectivedate",
  "lastreviewed",
  "learningobjective",
  "objective",
]);
export function presentLesson(source: ApprovedLearningSource) {
  const fields = source.source_fields.filter((f) => f.value.trim());
  const suppliedTitle = fields
    .find(
      (f) =>
        ["title", "topic", "name", "productname", "procedure"].includes(normalized(f.label)) &&
        f.value.trim().length <= 160,
    )
    ?.value.trim();
  const title = /^(?:column|row|record)\s*\d+$/i.test(source.title.trim())
    ? (suppliedTitle ??
      fields.find((f) => f.value.trim().length <= 160)?.value.trim() ??
      source.title)
    : source.title;
  const objective = fields.find((f) =>
    ["objective", "learningobjective"].includes(normalized(f.label)),
  )?.value;
  const sections = fields
    .filter((f) => !metadata.has(normalized(f.label)) && normalized(f.value) !== normalized(title))
    .map((field, index) => ({
      id: field.id,
      heading: /content|description|explanation|overview|guidance/i.test(field.label)
        ? "What you need to know"
        : /process|step|procedure|instruction/i.test(field.label)
          ? "How to apply it"
          : /mistake|avoid/i.test(field.label)
            ? "What to avoid"
            : /^column\s*\d+$/i.test(field.label)
              ? `Key idea ${index + 1}`
              : field.label,
      text: field.value,
      sourceLabel: field.label,
    }));
  return {
    title,
    objective: objective ?? `Identify and use the documented guidance for “${title}”.`,
    sections: sections.length
      ? sections
      : [
          {
            id: "body",
            heading: "What you need to know",
            text: source.body,
            sourceLabel: "Approved passage",
          },
        ],
    module:
      fields.find((f) =>
        ["category", "module", "department", "product"].includes(normalized(f.label)),
      )?.value ?? "Core knowledge",
  };
}
