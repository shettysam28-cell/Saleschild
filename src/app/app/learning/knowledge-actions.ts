"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/session";
import { canAuthor } from "@/lib/permissions";
export async function addApprovedKnowledge(input: unknown) {
  const ws = await requireWorkspace();
  if (!canAuthor(ws.role))
    return { error: "Only organization authors can add approved knowledge to a path." };
  const parsed = z
    .object({
      courseId: z.uuid(),
      sourceIds: z
        .array(z.uuid())
        .min(1)
        .max(50)
        .refine((ids) => new Set(ids).size === ids.length),
      requestId: z.uuid(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success)
    return { error: "Choose a draft path and 1–50 different approved resources." };
  const { data, error } = await ws.client.rpc("add_knowledge_to_learning_path", {
    org_id: ws.organization.id,
    course_id: parsed.data.courseId,
    source_ids: parsed.data.sourceIds,
    request_id: parsed.data.requestId,
  });
  if (error)
    return {
      error:
        error.code === "42501"
          ? "Every resource must be approved and belong to your organization."
          : error.code === "23505"
            ? "This approved source version is already in the path. Reopen the path before choosing more sources."
            : error.code === "22023"
              ? "Choose 1–50 approved resources and a draft learning path."
              : error.code === "40001"
                ? "This request was already used for other sources. Reopen the path before continuing."
                : ["PGRST202", "42883", "42703", "42P01"].includes(error.code ?? "")
                  ? "Apply the reviewed Universal Gateway migration before adding source knowledge."
                  : "The result could not be confirmed. Retry the same selection and request; completed additions are not duplicated.",
    };
  revalidatePath(`/app/learning/${parsed.data.courseId}`);
  revalidatePath("/app/learning");
  return { added: Number(data) };
}
