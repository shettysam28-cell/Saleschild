"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/session";
import { canAdmin, canAuthor } from "@/lib/permissions";
import type { LearningProgress } from "@/lib/learning/curriculum";
const savedProgress = z.object({
  unit_id: z.uuid(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  checkpoint_passed: z.boolean(),
  resume_step: z.number().int().min(0).max(2),
  updated_at: z.string().optional(),
});

function databaseMessage(
  code: string | undefined,
  purpose: "progress" | "publish" | "draft" = "progress",
) {
  if (["PGRST202", "42883", "42P01", "42703"].includes(code ?? ""))
    return "Learning publication and progress require the reviewed learning migration. No progress was saved.";
  if (code === "42501") return "This learning action is not available for your current membership.";
  if (code === "40001")
    return "The learning content changed. Reload and review the current source before continuing.";
  if (code === "22023")
    return purpose === "progress"
      ? "Review the approved source and choose the exact documented value before completing this checkpoint."
      : purpose === "draft"
        ? "Publish a reviewed learning revision before preparing its next draft."
        : "Review every approved source lesson and its order before publishing this learning revision.";
  return "The result could not be confirmed. Reload to check saved progress before retrying.";
}

export async function publishLearningRevision(input: unknown) {
  const ws = await requireWorkspace();
  if (!canAdmin(ws.role))
    return { error: "An owner or administrator must publish a learning revision." };
  const parsed = z
    .object({ courseId: z.uuid(), lessonIds: z.array(z.uuid()).min(1).max(500) })
    .strict()
    .safeParse(input);
  if (!parsed.success || new Set(parsed.data.lessonIds).size !== parsed.data.lessonIds.length)
    return { error: "Reopen the path and review its approved source lessons before publication." };
  const { data, error } = await ws.client.rpc("publish_learning_revision", {
    org_id: ws.organization.id,
    course_id: parsed.data.courseId,
    expected_lesson_ids: parsed.data.lessonIds,
  });
  if (error) return { error: databaseMessage(error.code, "publish") };
  if (!z.uuid().safeParse(data).success)
    return {
      error:
        "Publication could not be confirmed. Reload to check the published revision before retrying.",
    };
  revalidatePath(`/app/learning/${parsed.data.courseId}`);
  revalidatePath("/app/learning");
  return { revisionId: String(data) };
}

export async function beginLearningRevision(input: unknown) {
  const ws = await requireWorkspace();
  if (!canAdmin(ws.role))
    return { error: "An owner or administrator must prepare a learning revision." };
  const parsed = z.object({ courseId: z.uuid() }).strict().safeParse(input);
  if (!parsed.success)
    return { error: "Choose the published learning path to prepare its next draft." };
  const { data, error } = await ws.client.rpc("begin_learning_revision", {
    org_id: ws.organization.id,
    course_id: parsed.data.courseId,
  });
  if (error) return { error: databaseMessage(error.code, "draft") };
  if (data !== true)
    return {
      error: "Draft preparation could not be confirmed. Reload to check the current composition.",
    };
  revalidatePath(`/app/learning/${parsed.data.courseId}`);
  revalidatePath("/app/learning");
  return { prepared: Boolean(data) };
}

export async function recordLearningProgress(input: unknown): Promise<{
  error?: string;
  saved?: boolean;
  progress?: LearningProgress;
}> {
  const ws = await requireWorkspace();
  if (canAuthor(ws.role))
    return { error: "Owner and author previews do not record member progress." };
  const parsed = z
    .object({
      courseId: z.uuid(),
      revisionId: z.uuid(),
      unitId: z.uuid(),
      action: z.enum(["start", "resume", "complete"]),
      step: z.number().int().min(0).max(2),
      evidence: z.string().max(8000).optional(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { error: "Choose a unit in the published learning revision." };
  const { data, error } = await ws.client.rpc("record_learning_progress", {
    org_id: ws.organization.id,
    revision_id: parsed.data.revisionId,
    unit_id: parsed.data.unitId,
    action: parsed.data.action,
    step: parsed.data.step,
    evidence: parsed.data.evidence ?? null,
  });
  if (error) return { error: databaseMessage(error.code) };
  const saved = savedProgress.safeParse(data);
  if (
    !saved.success ||
    saved.data.unit_id !== parsed.data.unitId ||
    (parsed.data.action === "complete" &&
      (!saved.data.completed_at || !saved.data.checkpoint_passed))
  )
    return {
      error:
        "Saved progress could not be confirmed. Reload to check the current checkpoint before retrying.",
    };
  revalidatePath(`/app/learning/${parsed.data.courseId}`);
  revalidatePath("/app");
  revalidatePath("/app/analytics");
  return {
    saved: true,
    progress: saved.data,
  };
}
