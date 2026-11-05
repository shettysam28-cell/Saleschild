import { describe, expect, it } from "vitest";
import {
  buildCurriculum,
  sourceCheckpoint,
  summarizeProgress,
  resumeUnitIndex,
  type ApprovedLearningSource,
  type LearningProgress,
} from "@/lib/learning/curriculum";

const source = (changes: Partial<ApprovedLearningSource> = {}): ApprovedLearningSource => ({
  id: "unit-a",
  title: "Fictional equipment inspection",
  body: "Use the fictional green practice indicator before starting a supervised session.",
  source_knowledge_id: "knowledge-a",
  source_version: 3,
  position: 0,
  source_fields: [
    { id: "c1", label: "Team-specific instruction", value: "Use the green practice indicator." },
    { id: "c2", label: "Local owner", value: "Fictional Operations" },
  ],
  ...changes,
});
const progress = (changes: Partial<LearningProgress> = {}): LearningProgress => ({
  unit_id: "unit-a",
  started_at: "2026-11-04T10:00:00Z",
  completed_at: null,
  checkpoint_passed: false,
  resume_step: 0,
  ...changes,
});

describe("deterministic approved-source learning", () => {
  it("preserves arbitrary source fields, identity and version without a required schema", () => {
    const input = source();
    const result = buildCurriculum([input]);
    expect(result.units[0]).toMatchObject({
      title: input.title,
      body: input.body,
      source_knowledge_id: "knowledge-a",
      source_version: 3,
      facts: input.source_fields,
      objective: null,
      scenario: null,
    });
    expect(result.groups).toEqual(["Approved sources"]);
    expect(result.sourceCount).toBe(1);
  });
  it("omits unsourced lessons and leaves the caller's order untouched", () => {
    const later = source({ id: "later", position: 2 });
    const first = source({ id: "first", position: 0 });
    const unapproved = source({ id: "unsourced", source_version: null });
    const input = [later, first, unapproved];
    const result = buildCurriculum(input);
    expect(result.units.map((unit) => unit.id)).toEqual(["first", "later"]);
    expect(input.map((unit) => unit.id)).toEqual(["later", "first", "unsourced"]);
    expect(result.omitted).toBe(1);
    expect(result.sourceCount).toBe(1);
  });
  it("groups only by explicit source values and retains supplied objectives", () => {
    const result = buildCurriculum([
      source({
        source_fields: [
          { id: "c1", label: "Product", value: "Fictional Cedar" },
          { id: "c2", label: "Learning Objective", value: "Locate the approved indicator." },
        ],
      }),
    ]);
    expect(result.groups).toEqual(["Fictional Cedar"]);
    expect(result.units[0].objective).toBe("Locate the approved indicator.");
  });
  it("shows a scenario only when both situation and response are explicitly sourced", () => {
    const situation = {
      id: "c1",
      label: "Example Scenario",
      value: "The practice indicator is amber.",
    };
    const response = {
      id: "c2",
      label: "Correct Response",
      value: "Pause and ask the supervisor.",
    };
    expect(buildCurriculum([source({ source_fields: [situation] })]).units[0].scenario).toBeNull();
    expect(buildCurriculum([source({ source_fields: [response] })]).units[0].scenario).toBeNull();
    expect(
      buildCurriculum([source({ source_fields: [situation, response] })]).units[0].scenario,
    ).toEqual({
      situation: situation.value,
      response: response.value,
      evidence: ["c1", "c2"],
    });
  });
  it("never derives a response from prices, product names or arbitrary answer-like columns", () => {
    const result = buildCurriculum([
      source({
        source_fields: [
          { id: "c1", label: "Price", value: "€40" },
          { id: "c2", label: "Model", value: "Fictional Cedar" },
          { id: "c3", label: "Preferred answer", value: "Unsupported inference" },
        ],
      }),
    ]);
    expect(result.units[0].scenario).toBeNull();
    expect(result.units[0].objective).toBeNull();
    expect(result.units[0].facts.map((field) => field.value)).toEqual([
      "€40",
      "Fictional Cedar",
      "Unsupported inference",
    ]);
  });
  it("keeps repeated labels distinct by field identity", () => {
    const fields = [
      { id: "c1", label: "Detail", value: "First fact" },
      { id: "c2", label: "Detail", value: "Second fact" },
    ];
    expect(buildCurriculum([source({ source_fields: fields })]).units[0].facts).toEqual(fields);
  });
});

describe("source checkpoints match the SQL evidence contract", () => {
  it("uses the first bounded nonblank source value and only actual distinct source choices", () => {
    const checkpoint = sourceCheckpoint(
      source({
        source_fields: [
          { id: "c1", label: "Empty", value: "   " },
          { id: "c2", label: "Local instruction", value: "  Inspect the practice indicator.  " },
          { id: "c3", label: "Duplicate", value: "Inspect the practice indicator." },
          { id: "c4", label: "Supervisor", value: "Fictional Sam" },
        ],
      }),
    );
    expect(checkpoint).toEqual({
      label: "Local instruction",
      expected: "Inspect the practice indicator.",
      choices: ["Fictional Sam", "Inspect the practice indicator."],
      mode: "select",
    });
  });
  it("uses explicit source confirmation when a single distinct fact gives no honest alternatives", () => {
    const checkpoint = sourceCheckpoint(
      source({
        source_fields: [
          { id: "c1", label: "Instruction", value: "Read the supervisor-approved instruction." },
        ],
      }),
    );
    expect(checkpoint.mode).toBe("confirm");
    expect(checkpoint.choices).toEqual([]);
    expect(checkpoint.expected).toBe("Read the supervisor-approved instruction.");
  });
  it("counts Unicode code points like PostgreSQL, including the 500-character boundary", () => {
    const boundary = "🟢".repeat(500);
    expect(
      sourceCheckpoint(source({ source_fields: [{ id: "c1", label: "Unicode", value: boundary }] }))
        .expected,
    ).toBe(boundary);
    expect(
      sourceCheckpoint(
        source({ source_fields: [{ id: "c1", label: "Too long", value: boundary + "🟢" }] }),
      ).expected,
    ).toBe(source().body);
  });
  it("bounds fallback evidence to 2000 complete Unicode characters without surrogate splitting", () => {
    const checkpoint = sourceCheckpoint(
      source({ body: " " + "🟢".repeat(2001) + " ", source_fields: [] }),
    );
    expect(Array.from(checkpoint.expected)).toHaveLength(2000);
    expect(checkpoint.expected).toBe("🟢".repeat(2000));
    expect(checkpoint.mode).toBe("confirm");
  });
  it("matches ASCII-space btrim exactly without normalizing the source facts", () => {
    expect(
      sourceCheckpoint(
        source({ source_fields: [{ id: "c1", label: " Name ", value: "\u00a0Fact\u00a0" }] }),
      ).expected,
    ).toBe("\u00a0Fact\u00a0");
  });
});

describe("version-scoped consumption and resume", () => {
  it("counts eligible completed units rather than averaged path percentages or views", () => {
    const result = summarizeProgress(
      ["unit-a", "unit-b", "unit-c", "unit-d"],
      [
        progress({ completed_at: "2026-11-04T10:04:00Z", checkpoint_passed: true }),
        progress({ unit_id: "unit-b" }),
        progress({
          unit_id: "unit-c",
          completed_at: "2026-11-04T10:05:00Z",
          checkpoint_passed: false,
        }),
        progress({
          unit_id: "old-revision-unit",
          completed_at: "2026-11-04T10:06:00Z",
          checkpoint_passed: true,
        }),
      ],
    );
    expect(result).toEqual({ total: 4, completed: 1, remaining: 3, percentage: 25 });
  });
  it("deduplicates repeated completions and handles an empty denominator", () => {
    const completed = progress({ completed_at: "2026-11-04T10:04:00Z", checkpoint_passed: true });
    expect(summarizeProgress(["unit-a", "unit-a"], [completed, completed])).toEqual({
      total: 1,
      completed: 1,
      remaining: 0,
      percentage: 100,
    });
    expect(summarizeProgress([], [completed])).toEqual({
      total: 0,
      completed: 0,
      remaining: 0,
      percentage: 0,
    });
  });
  it("does not show 100 percent when one of 500 eligible units remains", () => {
    const ids = Array.from({ length: 500 }, (_, index) => `unit-${index}`);
    const completed = ids
      .slice(0, 499)
      .map((unit_id) =>
        progress({ unit_id, completed_at: "2026-11-04T10:04:00Z", checkpoint_passed: true }),
      );
    expect(summarizeProgress(ids, completed)).toMatchObject({
      completed: 499,
      remaining: 1,
      percentage: 99.8,
    });
    const manyIds = Array.from({ length: 2000 }, (_, index) => `unit-${index}`);
    const almostAll = manyIds
      .slice(0, 1999)
      .map((unit_id) =>
        progress({ unit_id, completed_at: "2026-11-04T10:04:00Z", checkpoint_passed: true }),
      );
    expect(summarizeProgress(manyIds, almostAll).percentage).toBe(99.9);
  });
  it("resumes the most recently saved eligible incomplete unit", () => {
    expect(
      resumeUnitIndex(
        ["unit-a", "unit-b"],
        [
          progress({ updated_at: "2026-11-04T10:00:00Z" }),
          progress({ unit_id: "unit-b", updated_at: "2026-11-04T12:00:00Z", resume_step: 1 }),
          progress({ unit_id: "old-revision-unit", updated_at: "2026-11-04T13:00:00Z" }),
        ],
      ),
    ).toBe(1);
  });
  it("starts the first remaining unit after completion without treating all-complete as an error", () => {
    expect(
      resumeUnitIndex(
        ["unit-a", "unit-b"],
        [progress({ completed_at: "2026-11-04T10:04:00Z", checkpoint_passed: true })],
      ),
    ).toBe(1);
    expect(resumeUnitIndex([], [])).toBe(0);
  });
});
