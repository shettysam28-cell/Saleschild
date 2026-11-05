import "server-only";
import { requireWorkspace } from "@/lib/session";
import { canAuthor } from "@/lib/permissions";
import type { DraftGroup, DraftManagerData } from "./draft-types";

export async function loadDraftManager(): Promise<DraftManagerData> {
  const ws = await requireWorkspace();
  if (!canAuthor(ws.role)) return { groups: [], error: "Author access is required." };
  const { data, error } = await ws.client.rpc("list_knowledge_draft_groups_v2", {
    org_id: ws.organization.id,
  });
  if (error)
    return {
      groups: [],
      error: ["PGRST202", "42883", "42P01", "42703"].includes(error.code)
        ? "Draft Manager requires the reviewed database migration. Existing knowledge remains available."
        : "Draft groups could not be loaded. Refresh to try again.",
    };
  return { groups: (data ?? []) as DraftGroup[] };
}
