"use server";
import { z } from "zod";
import { requireWorkspace } from "@/lib/session";
import { knowledgeQuery, answerFromSources, type GroundedAnswer } from "@/lib/knowledge/answers";
export type FetchResult = {
  answer?: GroundedAnswer;
  results?: { id: string; title: string; excerpt: string; version: number }[];
  message?: string;
  error?: boolean;
};
const source = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  current_version: z.coerce.number().int().positive(),
  custom_fields: z
    .array(z.object({ id: z.string(), label: z.string(), value: z.string() }))
    .max(32)
    .default([]),
});
export async function fetchKnowledge(query: string): Promise<FetchResult> {
  const { client, organization } = await requireWorkspace();
  const parsed = z.string().trim().min(2).max(200).safeParse(query);
  if (!parsed.success)
    return { error: true, message: "Enter 2–200 characters to find approved knowledge." };
  const queryPlan = knowledgeQuery(parsed.data);
  if (!queryPlan.terms.length)
    return {
      error: true,
      message: "Add a topic or keyword, such as a term used in your company knowledge.",
    };
  const result = await client.rpc("search_approved_knowledge", {
    org_id: organization.id,
    query_text: queryPlan.retrieval,
    result_limit: 5,
  });
  if (result.error?.code === "42501")
    return {
      error: true,
      message:
        "Your account cannot search approved knowledge in this workspace. Contact your owner.",
    };
  if (result.error?.code === "22023")
    return { error: true, message: "Use 2–200 characters and up to twelve search terms." };
  if (result.error)
    return {
      error: true,
      message:
        "Approved knowledge search is unavailable. Ask your administrator to verify the workspace migration, then try again.",
    };
  const records = source.array().max(5).safeParse(result.data);
  if (!records.success)
    return { error: true, message: "Search results could not be verified. Please try again." };
  const answer = answerFromSources(parsed.data, records.data);
  const matched = new Set(answer.citations.map((c) => c.knowledgeId));
  return {
    answer,
    results: records.data
      .filter((row) => matched.has(row.id))
      .map((row) => ({
        id: row.id,
        title: row.title,
        version: row.current_version,
        excerpt: row.body.length > 600 ? row.body.slice(0, 600) + "…" : row.body,
      })),
    message: answer.summary
      ? "Answer extracted from approved knowledge. Expand the citations to check context."
      : "No matching approved knowledge was found. Try a more specific term or ask your owner to review source coverage.",
  };
}
