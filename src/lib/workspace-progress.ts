import { z } from "zod";

const timestamp = z.iso.datetime({ offset: true }).nullable();
export const progressRowSchema = z.object({
  user_id: z.uuid(),
  course_id: z.uuid(),
  revision_id: z.uuid(),
  path_title: z.string(),
  revision_number: z.coerce.number().int().positive(),
  total_units: z.coerce.number().int().nonnegative(),
  completed_units: z.coerce.number().int().nonnegative(),
  started_at: timestamp,
  last_activity_at: timestamp,
  completed_at: timestamp,
});
export type ProgressRow = z.infer<typeof progressRowSchema>;
export function summarizeProgress(rows: ProgressRow[], range: { from?: string; to?: string } = {}) {
  const inRange = (value: string | null) => {
    if (!value) return false;
    const day = new Date(value).toISOString().slice(0, 10);
    return (!range.from || day >= range.from) && (!range.to || day <= range.to);
  };
  const eligible = rows.reduce((total, row) => total + row.total_units, 0);
  const completed = rows.reduce(
    (total, row) => total + Math.min(row.completed_units, row.total_units),
    0,
  );
  return {
    eligible,
    completed,
    remaining: eligible - completed,
    percent: !eligible
      ? 0
      : completed >= eligible
        ? 100
        : Math.min(99.9, Math.round((completed / eligible) * 1000) / 10),
    startedPaths: rows.filter((row) => inRange(row.started_at)).length,
    completedPaths: rows.filter(
      (row) =>
        row.total_units > 0 &&
        (range.from || range.to
          ? inRange(row.completed_at)
          : row.completed_units >= row.total_units),
    ).length,
  };
}
const dateSchema = z.iso.date();
export function parseAnalyticsFilters(input: Record<string, string | string[] | undefined>) {
  if (["from", "to", "member", "path"].some((key) => Array.isArray(input[key])))
    return { error: "Choose one value for each analytics filter." } as const;
  const single = (key: string) => (typeof input[key] === "string" ? input[key] : "");
  const from = single("from"),
    to = single("to"),
    member = single("member"),
    path = single("path");
  if ((from && !dateSchema.safeParse(from).success) || (to && !dateSchema.safeParse(to).success))
    return { error: "Choose valid start and end dates." } as const;
  if (from && to && from > to)
    return { error: "The start date must come before the end date." } as const;
  if (
    (member && !z.uuid().safeParse(member).success) ||
    (path && !z.uuid().safeParse(path).success)
  )
    return { error: "Choose an available member and learning path." } as const;
  return { from, to, member, path } as const;
}
