"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/session";
import { canAuthor, canAdmin } from "@/lib/permissions";
import {
  knowledgeSchema,
  courseSchema,
  organizationSchema,
  type ActionState,
} from "@/lib/validation";
const denied: ActionState = {
  error: true,
  message: "You don’t have permission to make this change.",
};
export async function createKnowledge(_state: ActionState, form: FormData): Promise<ActionState> {
  const { client, user, organization, role } = await requireWorkspace();
  if (!canAuthor(role)) return denied;
  const parsed = knowledgeSchema.safeParse(Object.fromEntries(form));
  if (parsed.success && parsed.data.status === "published" && !canAdmin(role)) return denied;
  if (!parsed.success)
    return {
      error: true,
      message:
        "Add a title, at least 20 characters of content, and a secure source URL if provided.",
    };
  const { error } = await client.from("knowledge_items").insert({
    ...parsed.data,
    source_url: parsed.data.source_url || null,
    organization_id: organization.id,
    created_by: user.id,
  });
  if (error) return { error: true, message: "We couldn’t save this resource. Please try again." };
  revalidatePath("/app");
  revalidatePath("/app/knowledge");
  return { success: true, message: "Your resource has been saved." };
}
export async function createCourse(_state: ActionState, form: FormData): Promise<ActionState> {
  const { client, user, organization, role } = await requireWorkspace();
  if (!canAuthor(role)) return denied;
  const parsed = courseSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: true, message: "Add a title and a description of at least 10 characters." };
  const { error } = await client.from("courses").insert({
    ...parsed.data,
    organization_id: organization.id,
    created_by: user.id,
    status: "draft",
  });
  if (error) return { error: true, message: "We couldn’t save this learning path." };
  revalidatePath("/app");
  revalidatePath("/app/learning");
  return {
    success: true,
    message:
      "Your draft learning path is saved. Open it to add approved knowledge as source-linked lessons.",
  };
}
export async function updateKnowledge(_state: ActionState, form: FormData): Promise<ActionState> {
  const { client, organization, role } = await requireWorkspace();
  if (!canAuthor(role)) return denied;
  const parsed = knowledgeSchema.safeParse(Object.fromEntries(form));
  if (parsed.success && parsed.data.status === "published" && !canAdmin(role)) return denied;
  const identity = z
    .object({ id: z.uuid(), version: z.coerce.number().int().positive() })
    .safeParse({ id: form.get("id"), version: form.get("version") });
  if (!parsed.success || !identity.success)
    return { error: true, message: "Check the resource details and try again." };
  const { data, error } = await client
    .from("knowledge_items")
    .update({ ...parsed.data, source_url: parsed.data.source_url || null })
    .eq("id", identity.data.id)
    .eq("organization_id", organization.id)
    .eq("status", "draft")
    .eq("current_version", identity.data.version)
    .select("id")
    .maybeSingle();
  if (error || !data)
    return {
      error: true,
      message: "This draft changed or is no longer editable. Reload the page before trying again.",
    };
  revalidatePath("/app/knowledge");
  revalidatePath("/app");
  return {
    success: true,
    message: "Your draft has been updated. Its previous version is preserved.",
  };
}
export async function requestWorkflow(_state: ActionState, form: FormData): Promise<ActionState> {
  const { client, user, organization, role } = await requireWorkspace();
  if (!canAuthor(role)) return denied;
  const parsed = z
    .object({
      objective: z.string().trim().min(10).max(2000),
      mode: z.enum(["manual", "assisted"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: true, message: "Describe your objective in 10–2,000 characters." };
  const { error } = await client.from("ai_workflows").insert({
    ...parsed.data,
    organization_id: organization.id,
    requested_by: user.id,
    status: "draft",
  });
  if (error) return { error: true, message: "We couldn’t save your workflow request." };
  revalidatePath("/app/workflows");
  return {
    success: true,
    message: "Draft request saved. No AI processing or external action has started.",
  };
}
export async function updateOrganization(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { client, organization, role } = await requireWorkspace();
  if (!canAdmin(role)) return denied;
  const parsed = organizationSchema.safeParse({ name: form.get("name") });
  if (!parsed.success)
    return { error: true, message: "Use an organization name of 2–100 characters." };
  const { data, error } = await client
    .from("organizations")
    .update({ name: parsed.data.name })
    .eq("id", organization.id)
    .select("id")
    .single();
  if (error || !data) return { error: true, message: "We couldn’t update your organization." };
  revalidatePath("/app", "layout");
  return { success: true, message: "Organization name updated." };
}
export async function markNotificationRead(form: FormData) {
  const { client, user, organization } = await requireWorkspace();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return;
  const { error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("organization_id", organization.id)
    .eq("user_id", user.id);
  if (error) throw new Error("Notification could not be updated.");
  revalidatePath("/app/notifications");
}
