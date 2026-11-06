import type { GatewayField } from "./gateway-model";

const ignored = new Set(
  "a an the what which how why when where who do does did is are was were can could would should i we you your our me my to of for in on at by and or please tell about explain find get have has it this that with from".split(
    " ",
  ),
);
const alternatives: Record<string, string[]> = {
  refund: ["reimburse", "money back"],
  refunds: ["refund", "reimburse"],
  reimbursement: ["refund", "reimburse"],
  workspace: ["workplace"],
  workplace: ["workspace"],
  gst: ["goods and services tax"],
  insurance: ["insured", "insurance cover"],
  policy: ["policies"],
};
export function knowledgeQuery(value: string) {
  const terms = [
    ...new Set(
      value
        .normalize("NFKC")
        .toLocaleLowerCase("en")
        .match(/[\p{L}\p{N}]+/gu) ?? [],
    ),
  ]
    .filter((word) => word.length > 1 && !ignored.has(word))
    .slice(0, 8);
  const related = [
    ...new Set(
      terms.flatMap((term) => [
        ...(alternatives[term] ?? []),
        ...(term.endsWith("ies") && term.length > 4
          ? [term.slice(0, -3) + "y"]
          : term.endsWith("s") && term.length > 4
            ? [term.slice(0, -1)]
            : []),
      ]),
    ),
  ];
  return {
    terms,
    related,
    retrieval: [...new Set([...terms, ...related.flatMap((x) => x.split(" "))])]
      .slice(0, 12)
      .join(" "),
  };
}
export type AnswerSource = {
  id: string;
  title: string;
  body: string;
  current_version: number;
  custom_fields: GatewayField[];
};
export type GroundedAnswer = {
  summary: { text: string; citation: string } | null;
  facts: { label: string; text: string; citation: string }[];
  steps: { text: string; citation: string }[];
  citations: {
    id: string;
    knowledgeId: string;
    version: number;
    title: string;
    excerpt: string;
    location: string;
  }[];
  notices: string[];
};
const compact = (text: string, limit = 520) =>
  text.length > limit ? text.slice(0, limit).trimEnd() + "…" : text;
const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
function relevance(text: string, query: ReturnType<typeof knowledgeQuery>) {
  const lower = text.toLowerCase();
  return (
    query.terms.reduce((n, t) => n + (lower.includes(t) ? 4 : 0), 0) +
    query.related.reduce((n, t) => n + (lower.includes(t) ? 2 : 0), 0)
  );
}
export function answerFromSources(question: string, sources: AnswerSource[]): GroundedAnswer {
  const query = knowledgeQuery(question);
  const ranked = sources
    .map((source) => ({
      source,
      score: relevance(source.title, query) * 2 + relevance(source.body, query),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id))
    .slice(0, 5);
  const answer: GroundedAnswer = {
    summary: null,
    facts: [],
    steps: [],
    citations: [],
    notices: [],
  };
  const seen = new Set<string>();
  const values = new Map<string, Set<string>>();
  for (const { source } of ranked) {
    const fields = source.custom_fields.filter(
      (f) =>
        f.value.trim() &&
        key(f.value) !== key(source.title) &&
        !/^(?:source reference|content owner|effective date|last reviewed|topic|category|subtopic|difficulty)$/i.test(
          f.label.trim(),
        ),
    );
    const priority = (f: GatewayField) =>
      relevance(f.label + " " + f.value, query) +
      (/content|guidance|summary|definition|process|step|explanation/i.test(f.label) ? 2 : 0);
    const ordered = [...fields].sort((a, b) => priority(b) - priority(a));
    const passages = source.body
      .split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z])/u)
      .filter(Boolean)
      .sort((a, b) => relevance(b, query) - relevance(a, query));
    const facts = ordered.length
      ? ordered.slice(0, 4).map((f) => ({
          label: /^column\s*\d+$/i.test(f.label) ? "Documented guidance" : f.label,
          text: f.value,
          fieldId: f.id,
        }))
      : [{ label: source.title, text: passages[0] ?? source.body, fieldId: "" }];
    for (const fact of facts) {
      if (seen.has(key(fact.text)) || answer.facts.length >= 8) continue;
      seen.add(key(fact.text));
      const id = "s" + (answer.citations.length + 1);
      answer.citations.push({
        id,
        knowledgeId: source.id,
        version: source.current_version,
        title: source.title,
        excerpt: fact.text,
        location: fact.fieldId ? `Field: ${fact.label} (${fact.fieldId})` : "Approved passage",
      });
      answer.facts.push({ label: fact.label, text: compact(fact.text), citation: id });
      if (!answer.summary) answer.summary = { text: compact(fact.text), citation: id };
      if (/step|procedure|process|instruction/i.test(fact.label)) {
        for (const step of fact.text
          .split(/\n+/)
          .filter((s) => s.trim())
          .slice(0, 6))
          answer.steps.push({ text: compact(step, 300), citation: id });
      }
      const fieldKey = key(source.title) + "/" + key(fact.label);
      const different = values.get(fieldKey) ?? new Set<string>();
      different.add(key(fact.text));
      values.set(fieldKey, different);
    }
  }
  if ([...values.values()].some((set) => set.size > 1))
    answer.notices.push(
      "Approved sources with the same topic and field contain different values. Compare their citations or ask your owner before acting.",
    );
  else if (ranked.length > 1)
    answer.notices.push(
      "Several approved sources match. Review the citations for the context that applies to your question.",
    );
  if (answer.facts.length)
    answer.notices.push(
      "Extracted from approved knowledge, without AI generation or independent factual verification. Missing details have not been invented.",
    );
  return answer;
}
