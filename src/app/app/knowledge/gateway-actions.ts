"use server";
import { createHash } from "node:crypto";
import {
  MAX_FILE_BYTES,
  MAX_ROWS,
  MAX_COLUMNS,
  uploadIssue,
} from "@/lib/knowledge/upload-contract";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/session";
import { canAuthor, canAdmin } from "@/lib/permissions";
import { extractGateway } from "@/lib/knowledge/gateway-extraction";
import { diagnostic, fail } from "@/lib/knowledge/diagnostics";
import {
  defaultChoices,
  reviewRows,
  type GatewayUpload,
  type DuplicateResult,
  type ReviewChoices,
} from "@/lib/knowledge/gateway-model";

const choicesSchema = z
  .object({
    sheet: z.number().int().min(0).max(19),
    headerRow: z.number().int().min(0).max(10000),
    titleColumn: z.string().regex(/^$|^c([1-9]|[12][0-9]|3[0-2])$/),
    labels: z.array(z.string().max(100)).max(MAX_COLUMNS),
    edits: z
      .record(
        z.string().regex(/^\d{1,2}:\d{1,5}$/),
        z
          .object({
            title: z.string().max(160).optional(),
            values: z
              .record(z.string().regex(/^c([1-9]|[12][0-9]|3[0-2])$/), z.string().max(12000))
              .optional(),
            excluded: z.boolean().optional(),
            confirmed: z.boolean().optional(),
          })
          .strict(),
      )
      .refine((v) => Object.keys(v).length <= 250),
  })
  .strict();
const identity = z.object({ id: z.uuid(), revision: z.number().int().nonnegative() });
type Workspace = Awaited<ReturnType<typeof requireWorkspace>>;
type Result = {
  error?: string;
  code?: string;
  upload?: GatewayUpload;
  duplicates?: DuplicateResult[];
  revision?: number;
  savedIds?: string[];
};
function failure(error: unknown): Result {
  const d = diagnostic(error);
  return { error: d.message, code: d.code };
}
function database(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "42501")
    fail(
      "PERMISSION",
      "Your author permission could not be verified. Sign in again or contact an administrator.",
    );
  if (error.code === "23505")
    fail(
      "DUPLICATE",
      "An exact duplicate was saved while you were reviewing. Refresh duplicate checks, skip it and retry. Nothing was overwritten.",
    );
  if (error.code === "40001")
    fail(
      "STALE_REVIEW",
      "This review or resource changed, expired or was already saved. Reopen it to get the latest version.",
    );
  if (error.code === "54000")
    fail(
      "UPLOAD_LIMIT",
      "Upload capacity was reached. Resume or discard an unused review, or try again after 24 hours.",
    );
  if (["PGRST202", "42883", "42703", "42P01"].includes(error.code ?? ""))
    fail(
      "DATABASE_SETUP",
      "The Universal Knowledge Gateway migration is not installed. Ask an administrator to apply the reviewed migration before using this feature.",
    );
  if (error.code === "22023")
    fail(
      "REVIEW",
      "Review the selected records and confirm possible duplicates. Save between 1 and 200 valid records.",
    );
  fail(
    "DATABASE",
    "The operation could not be confirmed. Keep this review and retry with the same request; completed saves are not duplicated.",
  );
}
async function getUpload(ws: Workspace, id: string): Promise<GatewayUpload> {
  if (!z.uuid().safeParse(id).success) fail("UPLOAD", "Choose a valid uploaded review.");
  const { data, error } = await ws.client
    .from("gateway_uploads")
    .select("id,source_name,extraction,choices,revision,expires_at,saved_ids")
    .eq("id", id)
    .eq("organization_id", ws.organization.id)
    .eq("created_by", ws.user.id)
    .maybeSingle();
  database(error);
  if (!data) fail("UPLOAD", "This upload is not available in your workspace.");
  if (!data.saved_ids && new Date(data.expires_at).getTime() <= Date.now())
    fail(
      "EXPIRED",
      "This review expired after 24 hours. Upload the source again; saved knowledge is preserved.",
    );
  return data as GatewayUpload;
}
async function duplicateResults(
  ws: Workspace,
  upload: GatewayUpload,
  choices: ReviewChoices,
): Promise<DuplicateResult[]> {
  const rows = reviewRows(upload.extraction, choices);
  if (!rows.length) return [];
  const { data, error } = await ws.client.rpc("check_gateway_duplicates", {
    org_id: ws.organization.id,
    candidates: rows.map((r) => ({ key: r.key, title: r.title, fields: r.fields })),
  });
  database(error);
  return (data ?? []) as DuplicateResult[];
}
export async function listGatewayUploads() {
  const ws = await requireWorkspace();
  if (!canAuthor(ws.role)) return [];
  const { data, error } = await ws.client
    .from("gateway_uploads")
    .select("id,source_name,expires_at")
    .eq("organization_id", ws.organization.id)
    .eq("created_by", ws.user.id)
    .is("saved_ids", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) return []; // Existing workspaces still render before the additive migration is released.
  return (data ?? []) as { id: string; source_name: string; expires_at: string }[];
}
export async function uploadGatewaySource(form: FormData): Promise<Result> {
  const ws = await requireWorkspace();
  if (!canAuthor(ws.role))
    return { error: "Only organization authors can upload knowledge.", code: "PERMISSION" };
  try {
    const file = form.get("file");
    if (!(file instanceof File)) fail("FILE_TYPE", "Choose a CSV, XLSX or DOCX source.");
    if (file.size > MAX_FILE_BYTES || !file.size)
      fail("FILE_LIMIT", "Choose a non-empty source no larger than 2 MiB.");
    const issue = uploadIssue(file);
    if (issue) fail("FILE_TYPE", issue);
    const digest = createHash("sha256")
      .update(new Uint8Array(await file.arrayBuffer()))
      .digest("hex");
    const name = file.name.replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 120);
    const cached = await ws.client
      .from("gateway_uploads")
      .select("id")
      .eq("organization_id", ws.organization.id)
      .eq("created_by", ws.user.id)
      .eq("source_digest", digest)
      .eq("source_name", name)
      .is("saved_ids", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    database(cached.error);
    if (cached.data) {
      const upload = await getUpload(ws, cached.data.id);
      return { upload, duplicates: await duplicateResults(ws, upload, upload.choices) };
    }
    const extraction = await extractGateway(file);
    const choices = defaultChoices(extraction);
    const { data, error } = await ws.client.rpc("stage_gateway_upload", {
      org_id: ws.organization.id,
      source_name: name,
      source_digest: digest,
      source_format: extraction.format,
      extraction,
      choices,
    });
    database(error);
    const upload = await getUpload(ws, String(data));
    return { upload, duplicates: await duplicateResults(ws, upload, choices) };
  } catch (error) {
    return failure(error);
  }
}
export async function loadGatewayUpload(id: string): Promise<Result> {
  const ws = await requireWorkspace();
  if (!canAuthor(ws.role))
    return { error: "Only organization authors can review uploads.", code: "PERMISSION" };
  try {
    const upload = await getUpload(ws, id);
    return {
      upload,
      duplicates: upload.saved_ids ? [] : await duplicateResults(ws, upload, upload.choices),
    };
  } catch (error) {
    return failure(error);
  }
}
export async function saveGatewayReview(input: unknown): Promise<Result> {
  const ws = await requireWorkspace();
  if (!canAuthor(ws.role))
    return { error: "Only organization authors can review uploads.", code: "PERMISSION" };
  try {
    const parsed = identity.extend({ choices: choicesSchema }).safeParse(input);
    if (!parsed.success)
      fail("REVIEW", "Check worksheet, header selection, column names and edited values.");
    if (new TextEncoder().encode(JSON.stringify(input)).length > 2500000)
      fail(
        "REVIEW_LIMIT",
        "The edited review exceeds 2.5 MB. Use a smaller source or shorter values.",
      );
    const { id, revision, choices } = parsed.data;
    const upload = await getUpload(ws, id);
    const sheet = upload.extraction.sheets[choices.sheet];
    if (!sheet || sheet.issue)
      fail("WORKSHEET", sheet?.issue?.message ?? "Choose a readable worksheet.");
    if (choices.headerRow !== 0 && !sheet.rows.some((r) => r.row === choices.headerRow))
      fail("HEADER", "Choose the header row from the uploaded worksheet.");
    const duplicates = await duplicateResults(ws, upload, choices);
    const rows = reviewRows(upload.extraction, choices, duplicates);
    if (Object.keys(choices.edits).some((key) => !rows.some((r) => r.key === key)))
      fail("REVIEW", "Edited rows must belong to the selected worksheet and header.");
    // Source snapshots are derived from the stored extraction by the database.
    // Persist only reviewed values and decisions, not duplicate copies of source text.
    const decisions = rows
      .filter((r) => !r.excluded)
      .map(({ key, row, title, fields, excluded, confirmed }) => ({
        key,
        row,
        title,
        fields,
        excluded,
        confirmed,
      }));
    if (new TextEncoder().encode(JSON.stringify(decisions)).length > 3500000)
      fail(
        "REVIEW_LIMIT",
        "The reviewed batch exceeds 3.5 MB. Exclude long records or split the source into smaller files.",
      );
    const { data, error } = await ws.client.rpc("save_gateway_review", {
      org_id: ws.organization.id,
      upload_id: id,
      expected_revision: revision,
      choices,
      rows: decisions,
    });
    database(error);
    return { revision: Number(data), duplicates };
  } catch (error) {
    return failure(error);
  }
}
export async function commitGatewayUpload(input: unknown): Promise<Result> {
  const ws = await requireWorkspace();
  if (!canAuthor(ws.role))
    return { error: "Only organization authors can save knowledge.", code: "PERMISSION" };
  try {
    const parsed = identity.extend({ requestId: z.uuid() }).safeParse(input);
    if (!parsed.success) fail("REQUEST", "Reopen your review before saving.");
    const upload = await getUpload(ws, parsed.data.id);
    if (!upload.saved_ids) {
      const rows = reviewRows(
        upload.extraction,
        upload.choices,
        await duplicateResults(ws, upload, upload.choices),
      ).filter((r) => !r.excluded);
      if (
        !rows.length ||
        rows.length > MAX_ROWS ||
        rows.some((r) => r.errors.length || r.exact.length || (r.possible.length && !r.confirmed))
      )
        fail(
          "REVIEW",
          "Fix or exclude invalid and exact-duplicate rows, and confirm any possible duplicates before saving 1–200 records.",
        );
    }
    const { data, error } = await ws.client.rpc("commit_gateway_upload", {
      org_id: ws.organization.id,
      upload_id: parsed.data.id,
      expected_revision: parsed.data.revision,
      request_id: parsed.data.requestId,
    });
    database(error);
    if (!Array.isArray(data) || !data.length || data.some((v) => !z.uuid().safeParse(v).success))
      fail("DATABASE", "The save result could not be confirmed. Retry this same request.");
    revalidatePath("/app/knowledge");
    revalidatePath("/app");
    return { savedIds: data as string[] };
  } catch (error) {
    return failure(error);
  }
}
export async function discardGatewayUpload(id: string): Promise<Result> {
  const ws = await requireWorkspace();
  if (!canAuthor(ws.role) || !z.uuid().safeParse(id).success)
    return { error: "Choose your own unused review.", code: "PERMISSION" };
  try {
    const { error } = await ws.client
      .from("gateway_uploads")
      .delete()
      .eq("id", id)
      .eq("organization_id", ws.organization.id)
      .eq("created_by", ws.user.id)
      .is("saved_ids", null);
    database(error);
    return {};
  } catch (error) {
    return failure(error);
  }
}
export async function updateGatewayKnowledge(input: unknown): Promise<Result> {
  const ws = await requireWorkspace();
  if (!canAuthor(ws.role))
    return { error: "Only organization authors can edit knowledge.", code: "PERMISSION" };
  try {
    const parsed = z
      .object({
        id: z.uuid(),
        version: z.number().int().positive(),
        title: z.string().trim().min(3).max(160),
        fields: z
          .array(
            z
              .object({
                id: z.string().regex(/^c([1-9]|[12][0-9]|3[0-2])$/),
                label: z.string().trim().min(1).max(100),
                value: z.string().trim().max(12000),
              })
              .strict(),
          )
          .min(1)
          .max(MAX_COLUMNS),
      })
      .strict()
      .safeParse(input);
    if (!parsed.success)
      fail("RECORD", "Check the title and custom field labels/values before saving.");
    const { data, error } = await ws.client.rpc("update_gateway_knowledge", {
      org_id: ws.organization.id,
      knowledge_id: parsed.data.id,
      expected_version: parsed.data.version,
      title: parsed.data.title,
      fields: parsed.data.fields,
    });
    database(error);
    revalidatePath("/app/knowledge");
    revalidatePath(`/app/knowledge/${parsed.data.id}`);
    revalidatePath("/app/learning");
    return { revision: Number(data) };
  } catch (error) {
    return failure(error);
  }
}
export async function approveGatewayKnowledge(input: unknown): Promise<Result> {
  const ws = await requireWorkspace();
  if (!canAdmin(ws.role))
    return {
      error: "An organization owner or administrator must approve publication.",
      code: "PERMISSION",
    };
  try {
    const parsed = z
      .object({ id: z.uuid(), version: z.number().int().positive() })
      .strict()
      .safeParse(input);
    if (!parsed.success) fail("RECORD", "Reopen the current saved draft before approving it.");
    const { data, error } = await ws.client
      .from("knowledge_items")
      .update({ status: "published" })
      .eq("id", parsed.data.id)
      .eq("organization_id", ws.organization.id)
      .eq("status", "draft")
      .eq("current_version", parsed.data.version)
      .select("current_version")
      .maybeSingle();
    database(error);
    if (!data)
      fail("STALE_REVIEW", "This draft changed or was already approved. Reload before continuing.");
    revalidatePath("/app/knowledge");
    revalidatePath(`/app/knowledge/${parsed.data.id}`);
    revalidatePath("/app/learning");
    return { revision: Number(data.current_version) };
  } catch (error) {
    return failure(error);
  }
}
