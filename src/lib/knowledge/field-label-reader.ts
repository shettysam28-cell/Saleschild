import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FieldLabels } from "./field-labels";
import { z } from "zod";
const rows = z
  .array(
    z.object({
      knowledge_id: z.uuid(),
      labels: z.record(z.string().regex(/^c(?:[1-9]|[12][0-9]|3[0-2])$/), z.string().max(100)),
    }),
  )
  .max(200);
export async function readFieldLabels(
  client: Pick<SupabaseClient, "rpc">,
  organizationId: string,
  ids: string[],
) {
  const unique = [...new Set(ids)];
  const result: Record<string, FieldLabels> = {};
  for (let start = 0; start < unique.length; start += 200) {
    const { data, error } = await client.rpc("read_knowledge_field_labels", {
      org_id: organizationId,
      knowledge_ids: unique.slice(start, start + 200),
    });
    // Missing/denied metadata never grants broader source access or invents labels.
    if (error) continue;
    const parsed = rows.safeParse(data);
    if (parsed.success) for (const row of parsed.data) result[row.knowledge_id] = row.labels;
  }
  return result;
}
