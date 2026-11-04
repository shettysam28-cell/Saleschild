import { notFound } from "next/navigation";
import { z } from "zod";
import { loadKnowledgeRecord } from "@/lib/knowledge/record";
import { KnowledgeRecordView } from "@/components/knowledge-record-view";
export default async function KnowledgeRecord({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await loadKnowledgeRecord(id);
  if (!data) notFound();
  return <KnowledgeRecordView data={data} />;
}
