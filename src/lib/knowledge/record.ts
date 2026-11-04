import "server-only";
import { requireWorkspace } from "@/lib/session";
import { canAuthor, canAdmin } from "@/lib/permissions";
import type { EditableKnowledge } from "@/components/gateway-record-editor";
export async function loadKnowledgeRecord(id: string) {
  const ws = await requireWorkspace();
  const { data, error } = await ws.client
    .from("knowledge_items")
    .select("id,title,body,status,source_url,current_version,custom_fields")
    .eq("organization_id", ws.organization.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw Error("Knowledge could not be loaded.");
  if (!data) return null;
  const author = canAuthor(ws.role),
    admin = canAdmin(ws.role);
  const source = author
    ? await ws.client
        .from("gateway_sources")
        .select("origin,original_fields")
        .eq("organization_id", ws.organization.id)
        .eq("knowledge_id", id)
        .maybeSingle()
    : { data: null, error: null };
  const versions = author
    ? await ws.client
        .from("knowledge_versions")
        .select("version,title,body,custom_fields,status,recorded_at")
        .eq("organization_id", ws.organization.id)
        .eq("knowledge_id", id)
        .order("version", { ascending: false })
        .limit(20)
    : { data: [], error: null };
  if (source.error || versions.error) throw Error("Source history could not be loaded.");
  return {
    record: data as EditableKnowledge & { source_url: string | null },
    source: source.data as {
      origin: Record<string, unknown>;
      original_fields: EditableKnowledge["custom_fields"];
    } | null,
    versions: (versions.data ?? []) as {
      version: number;
      title: string;
      body: string;
      custom_fields: EditableKnowledge["custom_fields"];
      status: string;
    }[],
    author,
    admin,
  };
}
