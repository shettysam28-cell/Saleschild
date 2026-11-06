import "server-only";
import { requireWorkspace } from "@/lib/session";
import { canAdmin, canAuthor } from "@/lib/permissions";
import type { ApprovedLearningSource, LearningProgress } from "./curriculum";
import { readFieldLabels } from "@/lib/knowledge/field-label-reader";
import { needsFieldLabels } from "@/lib/knowledge/field-labels";

export type LearningRevision = {
  id: string;
  course_id: string;
  number: number;
  title: string;
  published_at: string;
};
export type LearningWorkspace = {
  available: boolean;
  revision: LearningRevision | null;
  units: ApprovedLearningSource[];
  progress: LearningProgress[];
  author: boolean;
  canPublish: boolean;
};

export async function loadLearningWorkspace(courseId: string): Promise<LearningWorkspace> {
  const ws = await requireWorkspace();
  const base = {
    available: true,
    revision: null,
    units: [],
    progress: [],
    author: canAuthor(ws.role),
    canPublish: canAdmin(ws.role),
  };
  const { data, error } = await ws.client.rpc("read_learning_revision", {
    org_id: ws.organization.id,
    course_id: courseId,
  });
  if (error) {
    if (["PGRST202", "42883", "42P01", "42703"].includes(error.code ?? ""))
      return { ...base, available: false };
    throw Error("The published learning revision could not be loaded.");
  }
  if (!data) return base;
  const result = data as {
    revision: LearningRevision | null;
    units?: ApprovedLearningSource[];
    progress?: LearningProgress[];
  };
  const labels = await readFieldLabels(
    ws.client,
    ws.organization.id,
    (result.units ?? [])
      .filter((u) => needsFieldLabels(u.source_fields))
      .flatMap((u) => (u.source_knowledge_id ? [u.source_knowledge_id] : [])),
  );
  return {
    ...base,
    revision: result.revision,
    units: (result.units ?? []).map((u) => ({
      ...u,
      field_labels: u.source_knowledge_id ? labels[u.source_knowledge_id] : undefined,
    })),
    progress: base.author ? [] : (result.progress ?? []),
  };
}
