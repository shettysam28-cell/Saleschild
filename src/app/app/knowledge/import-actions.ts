"use server";
import { diagnostic, fail, type ImportDiagnostic } from "@/lib/knowledge/diagnostics";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/session";
import { canAuthor, canAdmin } from "@/lib/permissions";
import { columns, type Column, type SourceRecord } from "@/lib/knowledge/templates";
import { parseSource, type ParsedSource } from "@/lib/knowledge/spreadsheets";
import {
  assessReadiness,
  assessAcademyReadiness,
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
  diagnostic?: ImportDiagnostic;
};
function mappingFrom(form: FormData): Partial<Record<Column, string>> {
  const value = form.get("mapping");
  if (typeof value !== "string" || value.length > 5000)
    fail("MAPPING", "Check your column mapping.");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(value) as Record<string, unknown>;
  } catch {
    fail("MAPPING", "The column mapping is invalid. Choose the source columns again.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    fail("MAPPING", "Check your column mapping.");
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
    return {
      source: await parseSource(
        file,
        typeof form.get("worksheet") === "string"
          ? String(form.get("worksheet")) || undefined
          : undefined,
      ),
    };
  } catch (error) {
    const issue = diagnostic(error);
    return { error: issue.message, diagnostic: issue };
  }
}
function databaseFailure(error: { code?: string }): ImportResponse {
  const issue: ImportDiagnostic =
    error.code === "42501"
      ? {
          code: "PERMISSION",
          message:
            "Your organization author permission could not be verified. Sign in again or contact an administrator.",
        }
      : error.code === "23505"
        ? {
            code: "DUPLICATE",
            message:
              "This exact knowledge record already exists or was imported concurrently. Validate again and exclude duplicates; existing records were not overwritten.",
          }
        : ["PGRST202", "42883", "42703"].includes(error.code ?? "")
          ? {
              code: "DATABASE_SETUP",
              message:
                "The spreadsheet import database update is not installed. Ask an administrator to apply the reviewed import migration.",
            }
          : {
              code: "DATABASE",
              message:
                "The database could not complete this operation. No partial import was saved. Retry with the same file and worksheet.",
            };
  return { error: issue.message, diagnostic: issue };
}
export async function validateKnowledgeUpload(form: FormData): Promise<ImportResponse> {
  const { client, organization, role } = await requireWorkspace();
  if (!canAuthor(role)) return databaseFailure({ code: "42501" });
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "Choose a CSV or XLSX file." };
  try {
    const source = await parseSource(file, String(form.get("worksheet") ?? "") || undefined);
    const raw = String(form.get("excludedRows") ?? "[]");
    if (raw.length > 3000) fail("ROWS", "The excluded-row list is too large.");
    const excluded = JSON.parse(raw) as unknown;
    if (
      !Array.isArray(excluded) ||
      excluded.length > 200 ||
      excluded.some((n) => !Number.isInteger(n) || !source.rowNumbers?.includes(n))
    )
      fail("ROWS", "Choose excluded rows from the current worksheet preview.");
    const selected = source.rows
      .map((cells, i) => ({ cells, row: source.rowNumbers?.[i] ?? i + 2 }))
      .filter((r) => !excluded.includes(r.row));
    if (!selected.length) fail("ROWS", "Keep at least one knowledge record for import.");
    const records = mapRecords(
      source.headers,
      selected.map((r) => r.cells),
      mappingFrom(form),
    );
    const numbers = selected.map((r) => r.row);
    if (new TextEncoder().encode(JSON.stringify(records)).length > 2500000)
      fail(
        "RECORD_LIMIT",
        "Mapped knowledge exceeds the 2.5 MB database batch limit. Reduce long cell content or import a smaller batch.",
      );
    const approving = form.get("approve") === "yes";
    let existing: ExistingSource[] = [];
    if (!approving) {
      const check = await client.rpc("check_knowledge_import", {
        org_id: organization.id,
        records,
      });
      if (check.error) return databaseFailure(check.error);
      existing = (check.data ?? []) as ExistingSource[];
    }
    const readiness = assessReadiness(records, existing, undefined, numbers);
    if (!approving) return { readiness };
    if (!readiness.ready)
      return {
        readiness,
        error: "Resolve or exclude the invalid rows before importing. No records were imported.",
      };
    const requestId = String(form.get("requestId") ?? "");
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId))
      fail("REQUEST", "Restart the import to create a valid request.");
    const result = await client.rpc("import_knowledge_records_v2", {
      org_id: organization.id,
      request_id: requestId,
      source_name: source.name,
      records,
      source_context: { worksheet: source.worksheet ?? "CSV", rows: numbers },
    });
    if (result.error) return databaseFailure(result.error);
    if (
      typeof result.data !== "number" ||
      !Number.isInteger(result.data) ||
      result.data < 1 ||
      result.data > 200
    )
      return databaseFailure({});
    revalidatePath("/app/knowledge");
    revalidatePath("/app");
    return { imported: Number(result.data) };
  } catch (error) {
    const issue = diagnostic(error);
    return { error: issue.message, diagnostic: issue };
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
    readiness: assessAcademyReadiness(sources.map((r) => r.fields as SourceRecord)),
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
