import "server-only";
import { requireWorkspace } from "@/lib/session";
import type { ApprovedLearningSource } from "./curriculum";
import { readFieldLabels } from "@/lib/knowledge/field-label-reader";
import { needsFieldLabels } from "@/lib/knowledge/field-labels";

export async function loadStudyGuide(courseId: string, edition?: string) {
  const ws = await requireWorkspace();
  let query = ws.client
    .from("learning_path_revisions")
    .select("id,course_id,number,title,published_at")
    .eq("organization_id", ws.organization.id)
    .eq("course_id", courseId);
  if (edition) query = query.eq("id", edition);
  const revision = await query.order("number", { ascending: false }).limit(1).maybeSingle();
  if (revision.error) throw Error("The published learning edition could not be loaded.");
  if (!revision.data) return null;
  const id = String(revision.data.id);
  const [marker, units] = await Promise.all([
    ws.client
      .from("learning_revision_guides")
      .select("created_at")
      .eq("organization_id", ws.organization.id)
      .eq("revision_id", id)
      .eq("user_id", ws.user.id)
      .maybeSingle(),
    ws.client
      .from("learning_revision_units")
      .select("id,title,body,position,source_knowledge_id,source_version,source_fields")
      .eq("organization_id", ws.organization.id)
      .eq("revision_id", id)
      .order("position")
      .limit(500),
  ]);
  if (marker.error || units.error)
    throw Error(
      "Your revision guide could not be loaded. Verify the approved guide migration or retry later.",
    );
  const unitRows = (units.data ?? []) as ApprovedLearningSource[];
  const labels = await readFieldLabels(
    ws.client,
    ws.organization.id,
    unitRows
      .filter((u) => needsFieldLabels(u.source_fields))
      .flatMap((u) => (u.source_knowledge_id ? [u.source_knowledge_id] : [])),
  );
  return {
    courseId,
    revision: revision.data as { id: string; title: string; number: number; published_at: string },
    savedAt: marker.data?.created_at as string | undefined,
    units: unitRows.map((u) => ({
      ...u,
      field_labels: u.source_knowledge_id ? labels[u.source_knowledge_id] : undefined,
    })),
  };
}
