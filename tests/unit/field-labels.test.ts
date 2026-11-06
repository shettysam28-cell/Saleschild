import { describe, it, expect } from "vitest";
import { displayFields, primaryField } from "@/lib/knowledge/field-labels";
import { sourceCheckpoint } from "@/lib/learning/curriculum";
describe("non-destructive mapped source presentation", () => {
  it("preserves explicit labels, values, IDs and order while resolving generic labels", () => {
    const fields = [
      { id: "c1", label: "Column 1", value: "Fictional guide" },
      { id: "c2", label: "My company guidance", value: "Preserve my documented source value." },
    ];
    const before = JSON.stringify(fields);
    expect(displayFields(fields, { c1: "Topic", c2: "Knowledge Content" })).toEqual([
      { ...fields[0], label: "Topic" },
      fields[1],
    ]);
    expect(JSON.stringify(fields)).toBe(before);
    expect(displayFields(fields)[0].label).toBe("Unmapped field c1");
    expect(displayFields(fields, { c1: "Column 1" })[0].label).toBe("Unmapped field c1");
  });
  it("keeps checkpoint evidence and options identical when presentation labels change", () => {
    const source = {
      body: "Fictional source",
      source_fields: [
        { id: "c1", label: "Column 1", value: "Fictional topic" },
        { id: "c2", label: "Column 2", value: "Fictional guidance." },
      ],
    };
    const original = sourceCheckpoint(source);
    expect(
      sourceCheckpoint({ ...source, field_labels: { c1: "Topic", c2: "Knowledge Content" } }),
    ).toEqual({ ...original, label: "Topic" });
    expect(
      primaryField(
        displayFields(source.source_fields, { c1: "Topic", c2: "Knowledge Content" }),
        "Fictional topic",
      )?.id,
    ).toBe("c2");
  });
});
