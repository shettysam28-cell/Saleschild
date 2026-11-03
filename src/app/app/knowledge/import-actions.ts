"use server";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/session";
import { canAuthor, canAdmin } from "@/lib/permissions";
import { columns, type Column, type SourceRecord } from "@/lib/knowledge/templates";
import { parseSource, type ParsedSource } from "@/lib/knowledge/spreadsheets";
import {
  assessReadiness,
  mapRecords,
  curriculumPreview,
  type Readiness,
  type ExistingSource,
} from "@/lib/knowledge/readiness";

type ImportResponse = {
  error?: string;
  source?: ParsedSource;
  readiness?: Readiness;
  imported?: number;
};
function mappingFrom(form: FormData): Partial<Record<Column, string>> {
  const value = form.get("mapping");
  if (typeof value !== "string" || value.length > 5000)
    throw new Error("Check your column mapping.");
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Check your column mapping.");
  return Object.fromEntries(
    columns.map((c) => [c, typeof parsed[c] === "string" ? parsed[c] : ""]),
  ) as Partial<Record<Column, string>>;
}
export async function inspectKnowledgeUpload(form: FormData): Promise<ImportResponse> {
  const { role } = await requireWorkspace();
  if (!canAuthor(role)) return { error: "Only organization authors can import knowledge." };
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "Choose a CSV or XLSX file." };
  try {
    return { source: await parseSource(file) };
  } catch {
    return {
      error:
        "Could not read this source. Use a plain UTF-8 CSV or XLSX, at most 2 MiB, 200 rows and 32 columns. Remove formulas, external links and embedded objects.",
    };
  }
}
export async function validateKnowledgeUpload(form: FormData): Promise<ImportResponse> {
  const { client, organization, role } = await requireWorkspace();
  if (!canAuthor(role)) return { error: "Only organization authors can import knowledge." };
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "Choose a CSV or XLSX file." };
  try {
    const source = await parseSource(file),
      records = mapRecords(source.headers, source.rows, mappingFrom(form));
    // The database repeats duplicate/conflict checks atomically at commit time.
    const { data, error } = await client.rpc("check_knowledge_import", {
      org_id: organization.id,
      records,
    });
    if (error)
      return {
        error:
          "Readiness could not be checked against your organization. No records were imported.",
      };
    const readiness = assessReadiness(records, (data ?? []) as ExistingSource[]);
    if (form.get("approve") !== "yes") return { readiness };
    if (!readiness.ready)
      return {
        readiness,
        error: "Resolve the validation errors before importing. No records were imported.",
      };
    const requestId = form.get("requestId");
    if (typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId))
      return { error: "Restart the import to create a valid request." };
    const result = await client.rpc("import_knowledge_records", {
      org_id: organization.id,
      request_id: requestId,
      source_name: source.name,
      records,
    });
    if (result.error)
      return {
        error:
          "Nothing was imported. The source may now conflict with another import, or access may have changed. Validate again before retrying.",
      };
    revalidatePath("/app/knowledge");
    revalidatePath("/app");
    return { imported: Number(result.data) };
  } catch {
    return { error: "Check your file and column mapping. No records were imported." };
  }
}
export async function previewAcademy() {
  const { client, organization, role } = await requireWorkspace();
  if (!canAdmin(role))
    return { error: "An organization administrator must review academy proposals." };
  const { data, error } = await client
    .from("knowledge_source_records")
    .select("knowledge_id,fields,knowledge_items!inner(status,current_version,title,body)")
    .eq("organization_id", organization.id)
    .eq("knowledge_items.status", "published")
    .order("created_at")
    .limit(201);
  if (error) return { error: "Approved sources could not be loaded. No academy was generated." };
  if (!data?.length)
    return {
      error:
        "Publish reviewed source knowledge first. Imported drafts cannot be used in an academy preview.",
    };
  if (data.length > 200)
    return {
      error: "This preview supports up to 200 approved source records. No content was published.",
    };
  // A publication status change preserves the source text; content edits require reconciliation.
  const sources = data.filter((r) => {
    const item = Array.isArray(r.knowledge_items) ? r.knowledge_items[0] : r.knowledge_items;
    const fields = r.fields as SourceRecord;
    return item?.title === fields.Topic && item?.body === fields["Knowledge Content"];
  });
  if (!sources.length)
    return {
      error:
        "Source snapshots changed after import. Review and reconcile the current knowledge version before creating a preview.",
    };
  return {
    readiness: assessReadiness(sources.map((r) => r.fields as SourceRecord)),
    curriculum: curriculumPreview(
      sources.map((r) => ({
        id: r.knowledge_id,
        version: (Array.isArray(r.knowledge_items) ? r.knowledge_items[0] : r.knowledge_items)
          .current_version,
        fields: r.fields as SourceRecord,
      })),
    ),
    omitted: data.length - sources.length,
  };
}
