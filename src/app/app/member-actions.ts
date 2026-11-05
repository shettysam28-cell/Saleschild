"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { appOrigin } from "@/lib/config";
import { requireUser, requireWorkspace } from "@/lib/session";
import { memberProvisioningReadiness } from "@/lib/member-management";
import { createMemberAuthProvider } from "@/lib/supabase/member-auth-admin";
import {
  provisionMemberWithProvider,
  resetMemberWithProvider,
  type MemberProvisioningStore,
} from "@/lib/member-provisioning";
import type { ActionState } from "@/lib/validation";
import type { SupabaseClient } from "@supabase/supabase-js";

export type MemberActionState = ActionState & { temporaryPasscode?: string };
const denied: ActionState = {
  error: true,
  message: "Only the organization owner can manage members.",
};
async function sameOrigin() {
  const origin = appOrigin();
  const supplied = (await headers()).get("origin");
  return Boolean(origin && (!supplied || supplied === origin));
}
function storeFor(client: SupabaseClient): MemberProvisioningStore {
  async function rpc(name: string, args: Record<string, string>) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error("Member operation could not be completed.");
    return data;
  }
  return {
    async reserve(request) {
      const result = await rpc("reserve_member", {
        org_id: request.organizationId,
        operation_id: request.operationId,
        member_email: request.email,
        member_name: request.name,
      });
      return result?.created === true;
    },
    async attach(request, userId) {
      await rpc("attach_provisioned_member", {
        org_id: request.organizationId,
        operation_id: request.operationId,
        identity_id: userId,
      });
    },
    async fail(request) {
      await rpc("fail_member_reservation", {
        org_id: request.organizationId,
        operation_id: request.operationId,
      });
    },
    async beginReset(organizationId, userId) {
      return String(await rpc("begin_member_reset", { org_id: organizationId, member_id: userId }));
    },
    async finishReset(organizationId, userId) {
      await rpc("finalize_member_reset", { org_id: organizationId, member_id: userId });
    },
  };
}

export async function updateProfile(_state: ActionState, form: FormData): Promise<ActionState> {
  if (!(await sameOrigin())) return { error: true, message: "Your account could not be updated." };
  const parsed = z.string().trim().min(1).max(100).safeParse(form.get("display_name"));
  if (!parsed.success) return { error: true, message: "Use a name of 1–100 characters." };
  const { client, user } = await requireUser();
  const { data: existing, error: readError } = await client
    .from("profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) return { error: true, message: "Your profile could not be loaded." };
  const query = existing
    ? client.from("profiles").update({ display_name: parsed.data }).eq("user_id", user.id)
    : client.from("profiles").insert({ user_id: user.id, display_name: parsed.data });
  const { error } = await query;
  if (error) return { error: true, message: "Your name could not be saved. Please try again." };
  revalidatePath("/app", "layout");
  return { success: true, message: "Your name has been updated." };
}

export async function provisionMember(
  _state: MemberActionState,
  form: FormData,
): Promise<MemberActionState> {
  if (!(await sameOrigin())) return denied;
  const { client, organization, role } = await requireWorkspace();
  if (role !== "owner") return denied;
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(100),
      email: z.email().trim().toLowerCase().max(254),
      operation_id: z.uuid(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: true, message: "Enter a valid name and email, then retry the member form." };
  const readiness = memberProvisioningReadiness();
  if (!readiness.available) return { error: true, message: readiness.reason };
  const provider = createMemberAuthProvider();
  if (!provider) return { error: true, message: "Secure member account setup is unavailable." };
  try {
    const result = await provisionMemberWithProvider(
      {
        organizationId: organization.id,
        operationId: parsed.data.operation_id,
        email: parsed.data.email,
        name: parsed.data.name,
      },
      provider,
      storeFor(client),
    );
    revalidatePath("/app/settings");
    return { ...result, error: !result.success };
  } catch {
    return {
      error: true,
      message:
        "A member could not be reserved. Check the two-seat limit, duplicate email, and management rate limit.",
    };
  }
}

export async function resetMemberPasscode(
  _state: MemberActionState,
  form: FormData,
): Promise<MemberActionState> {
  if (!(await sameOrigin())) return denied;
  const { client, organization, role } = await requireWorkspace();
  if (role !== "owner") return denied;
  const id = z.uuid().safeParse(form.get("user_id"));
  if (!id.success) return { error: true, message: "Choose a valid member." };
  const readiness = memberProvisioningReadiness();
  if (!readiness.available) return { error: true, message: readiness.reason };
  const provider = createMemberAuthProvider();
  if (!provider) return { error: true, message: "Secure passcode reset is unavailable." };
  try {
    const result = await resetMemberWithProvider(
      organization.id,
      id.data,
      provider,
      storeFor(client),
    );
    revalidatePath("/app/settings");
    return { ...result, error: !result.success };
  } catch {
    return {
      error: true,
      message:
        "This member could not be reset. Existing unrelated identities cannot be reset here.",
    };
  }
}

export async function removeMember(_state: ActionState, form: FormData): Promise<ActionState> {
  if (!(await sameOrigin())) return denied;
  const { client, organization, role } = await requireWorkspace();
  if (role !== "owner") return denied;
  const id = z.uuid().safeParse(form.get("user_id"));
  if (!id.success || form.get("confirm") !== "remove")
    return { error: true, message: "Confirm removal of the selected member." };
  const { error } = await client.rpc("remove_workspace_member", {
    org_id: organization.id,
    member_id: id.data,
  });
  if (error)
    return {
      error: true,
      message: "This member could not be removed. Refresh the member list and try again.",
    };
  revalidatePath("/app/settings");
  revalidatePath("/app/analytics");
  return {
    success: true,
    message:
      "Organization access has been revoked. Learning history and the Auth identity are retained.",
  };
}

export async function recordPresence(): Promise<void> {
  if (!(await sameOrigin())) return;
  const { client, organization } = await requireWorkspace();
  // Presence is approximate, bounded by a database-side two-minute throttle,
  // and never counts as learning progress or completion.
  await client.rpc("record_workspace_presence", { org_id: organization.id });
}
