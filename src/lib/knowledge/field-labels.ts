import type { GatewayField } from "./gateway-model";
export type FieldLabels = Record<string, string>;
const generic = (label: string) => !label.trim() || /^column\s*\d+$/i.test(label.trim());
export const needsFieldLabels = (fields: GatewayField[]) => fields.some((f) => generic(f.label));
/** Presentation only: source IDs, order and values remain unchanged. */
export function displayFields(fields: GatewayField[], labels: FieldLabels = {}): GatewayField[] {
  return fields.map((field) => ({
    ...field,
    label: !generic(field.label)
      ? field.label
      : !generic(labels[field.id] ?? "")
        ? labels[field.id].trim()
        : `Unmapped field ${field.id}`,
  }));
}
export function primaryField(fields: GatewayField[], title = "") {
  return (
    fields.find(
      (f) =>
        f.value.trim() &&
        /knowledge.?content|company.?guidance|description|local.?practice|documented.?detail/i.test(
          f.label,
        ),
    ) ??
    [...fields]
      .filter((f) => f.value.trim() && f.value.trim() !== title.trim())
      .sort((a, b) => b.value.length - a.value.length)[0] ??
    fields[0]
  );
}
