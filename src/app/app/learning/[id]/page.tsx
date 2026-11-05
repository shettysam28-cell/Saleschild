import { notFound } from "next/navigation";
import { z } from "zod";
import { loadLearningPath } from "@/lib/knowledge/learning";
import { LearningPathView } from "@/components/learning-path-view";
import { loadLearningWorkspace } from "@/lib/learning/read-model";
export default async function LearningPath({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await loadLearningPath(id);
  if (!data) notFound();
  const learning = await loadLearningWorkspace(id);
  return <LearningPathView data={data} learning={learning} />;
}
