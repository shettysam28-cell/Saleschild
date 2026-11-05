"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/session";
import { canAuthor } from "@/lib/permissions";
import { loadDraftManager } from "@/lib/knowledge/draft-manager";
import type { DraftManagerData } from "@/lib/knowledge/draft-types";

const request = z
  .object({
    id: z.uuid(),
    kind: z.enum(["gateway", "legacy", "review"]),
    confirmed: z.literal(true),
    records: z
      .array(z.object({ id: z.uuid(), version: z.number().int().positive() }).strict())
      .max(200),
  })
  .strict();
export async function discardDraftGroup(input: unknown): Promise<DraftManagerData> {
  const ws = await requireWorkspace();
  if (!canAuthor(ws.role))
    return { groups: [], error: "Only organization authors can discard drafts." };
  const parsed = request.safeParse(input);
  if (!parsed.success)
    return { groups: [], error: "Confirm the current draft group before discarding." };
  const { data: count, error } = await ws.client.rpc("discard_knowledge_draft_group", {
    org_id: ws.organization.id,
    group_id: parsed.data.id,
    group_kind: parsed.data.kind,
    expected_records: parsed.data.records,
  });
  if (error) {
    const message =
      error.code === "40001"
        ? "These drafts changed. Refresh the group and review the current records before discarding."
        : error.code === "55000"
          ? "This group contains approved knowledge or learning dependencies. Preserve it and review individual drafts. Nothing was discarded."
          : error.code === "42501"
            ? "This group is not available with your current author access."
            : "The discard could not be confirmed. Refresh before retrying; existing knowledge is preserved.";
    return { groups: [], error: message };
  }
  if (typeof count !== "number")
    return { groups: [], error: "The discard result could not be verified. Refresh the group." };
  revalidatePath("/app/knowledge");
  revalidatePath("/app");
  return loadDraftManager();
}
