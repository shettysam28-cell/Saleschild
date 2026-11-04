import "server-only";
import { requireWorkspace } from "@/lib/session";
import { canAuthor } from "@/lib/permissions";
import type { GatewayField } from "./gateway-model";
export type SourceLesson = {
  id: string;
  title: string;
  body: string;
  position: number;
  source_knowledge_id: string | null;
  source_version: number | null;
  source_fields: GatewayField[];
};
export async function loadLearningPath(id: string) {
  const ws = await requireWorkspace();
  const result = await ws.client.rpc("read_learning_path", {
    org_id: ws.organization.id,
    course_id: id,
  });
  if (result.error) throw Error("The learning path could not be loaded.");
  if (!result.data) return null;
  const author = canAuthor(ws.role);
  const approved = author
    ? await ws.client
        .from("knowledge_items")
        .select("id,title,current_version")
        .eq("organization_id", ws.organization.id)
        .eq("status", "published")
        .order("title")
        .limit(200)
    : { data: [], error: null };
  if (approved.error) throw Error("Approved knowledge could not be loaded.");
  return {
    ...(result.data as {
      course: { id: string; title: string; description: string; status: string };
      lessons: SourceLesson[];
    }),
    author,
    approved: (approved.data ?? []) as { id: string; title: string; current_version: number }[],
  };
}
