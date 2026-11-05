import { notFound } from "next/navigation";
import { z } from "zod";
import { loadStudyGuide } from "@/lib/learning/guides";
import { RevisionGuideView } from "@/components/revision-guide";
export default async function RevisionGuidePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edition?: string }>;
}) {
  const { id } = await params,
    { edition } = await searchParams;
  if (!z.uuid().safeParse(id).success || (edition && !z.uuid().safeParse(edition).success))
    notFound();
  const data = await loadStudyGuide(id, edition);
  if (!data) notFound();
  return <RevisionGuideView data={data} />;
}
