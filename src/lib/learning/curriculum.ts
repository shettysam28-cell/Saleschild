import type { GatewayField } from "@/lib/knowledge/gateway-model";

export type ApprovedLearningSource = {
  id: string;
  lesson_id?: string;
  title: string;
  body: string;
  position: number;
  source_knowledge_id: string | null;
  source_version: number | null;
  source_fields: GatewayField[];
};
export type SourceCheckpoint = {
  label: string;
  expected: string;
  choices: string[];
  mode: "select" | "confirm";
};
export type LearningUnit = ApprovedLearningSource & {
  group: string;
  objective: string | null;
  facts: GatewayField[];
  scenario: { situation: string; response: string; evidence: string[] } | null;
  checkpoint: SourceCheckpoint;
};
export type LearningProgress = {
  unit_id: string;
  started_at: string | null;
  completed_at: string | null;
  checkpoint_passed: boolean;
  resume_step: number;
  updated_at?: string;
};

// Match PostgreSQL btrim(text) and character counting exactly. Evidence is public
// approved source text, not an assessment answer key or an authorization token.
const trimSpaces = (value: string) => value.replace(/^ +| +$/g, "");
const codepoints = (value: string) => Array.from(value);
const labelKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function sourceCheckpoint(source: Pick<ApprovedLearningSource, "body" | "source_fields">) {
  const field = source.source_fields.find((f) => {
    const value = trimSpaces(f.value);
    return value.length > 0 && codepoints(value).length <= 500;
  });
  const expected = field
    ? trimSpaces(field.value)
    : codepoints(trimSpaces(source.body)).slice(0, 2000).join("");
  const choices = [...new Set(source.source_fields.map((f) => trimSpaces(f.value)))]
    .filter((value) => value && codepoints(value).length <= 500 && value !== expected)
    .slice(0, 3);
  if (field && choices.length) choices.push(expected);
  choices.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    label: field ? trimSpaces(field.label) || "Source content" : "Source content",
    expected,
    choices: field && choices.length > 1 ? choices : [],
    mode: field && choices.length > 1 ? ("select" as const) : ("confirm" as const),
  };
}

/** Deterministic organization only: every factual string comes from its snapshot. */
export function buildCurriculum(sources: ApprovedLearningSource[]) {
  const eligible = [...sources]
    .filter((source) => source.source_knowledge_id && source.source_version)
    .sort((a, b) => a.position - b.position);
  const units: LearningUnit[] = eligible.map((source) => {
    const facts = source.source_fields.filter((field) => field.value.trim());
    const field = (aliases: string[]) =>
      facts.find((candidate) => aliases.includes(labelKey(candidate.label)));
    const group = field(["category", "module", "product", "department"]);
    const objective = field(["learningobjective", "objective"]);
    const situation = field(["examplescenario", "scenario"]);
    const response = field(["correctresponse", "approvedresponse"]);
    return {
      ...source,
      group: group && codepoints(group.value).length <= 160 ? group.value : "Approved sources",
      objective: objective?.value ?? null,
      facts,
      scenario:
        situation && response
          ? {
              situation: situation.value,
              response: response.value,
              evidence: [situation.id, response.id],
            }
          : null,
      checkpoint: sourceCheckpoint(source),
    };
  });
  return {
    units,
    groups: [...new Set(units.map((unit) => unit.group))],
    sourceCount: new Set(units.map((unit) => `${unit.source_knowledge_id}:${unit.source_version}`))
      .size,
    omitted: sources.length - units.length,
  };
}

export function summarizeProgress(unitIds: string[], progress: LearningProgress[]) {
  const eligible = new Set(unitIds);
  const completed = new Set(
    progress
      .filter((p) => eligible.has(p.unit_id) && p.completed_at && p.checkpoint_passed)
      .map((p) => p.unit_id),
  ).size;
  return {
    total: eligible.size,
    completed,
    remaining: eligible.size - completed,
    percentage: eligible.size
      ? Math.min(
          completed === eligible.size ? 100 : 99.9,
          Math.round((completed / eligible.size) * 1000) / 10,
        )
      : 0,
  };
}

export function resumeUnitIndex(unitIds: string[], progress: LearningProgress[]) {
  const eligible = new Set(unitIds);
  const active = [...progress]
    .filter((p) => eligible.has(p.unit_id) && p.started_at && !p.completed_at)
    .sort((a, b) =>
      (b.updated_at ?? b.started_at ?? "").localeCompare(a.updated_at ?? a.started_at ?? ""),
    )[0];
  if (active) return unitIds.indexOf(active.unit_id);
  const completed = new Set(
    progress.filter((p) => p.completed_at && p.checkpoint_passed).map((p) => p.unit_id),
  );
  const next = unitIds.findIndex((id) => !completed.has(id));
  return Math.max(0, next);
}
