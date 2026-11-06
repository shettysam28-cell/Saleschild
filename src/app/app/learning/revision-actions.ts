"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/session";

export async function createRevisionGuide(input: unknown) {
  const parsed = z.object({ courseId: z.uuid(), revisionId: z.uuid() }).strict().safeParse(input);
  if (!parsed.success)
    return { error: "Choose a published learning path before preparing a guide." };
  const ws = await requireWorkspace();
  const revision = await ws.client
    .from("learning_path_revisions")
    .select("id")
    .eq("organization_id", ws.organization.id)
    .eq("course_id", parsed.data.courseId)
    .eq("id", parsed.data.revisionId)
    .maybeSingle();
  if (revision.error || !revision.data)
    return {
      error:
        "A published edition is required. Ask your owner to publish the reviewed learning path.",
    };
  const result = await ws.client.rpc("save_learning_guide", {
    org_id: ws.organization.id,
    revision_id: parsed.data.revisionId,
  });
  if (result.error || result.data !== parsed.data.revisionId)
    return {
      error:
        "The revision guide was not confirmed saved. Verify workspace access and the reviewed guide migration, then retry.",
    };
  revalidatePath(`/app/learning/${parsed.data.courseId}/revision`);
  return {
    url: `/app/learning/${parsed.data.courseId}/revision?edition=${parsed.data.revisionId}`,
  };
}
