"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { appOrigin } from "@/lib/config";
import type { ActionState } from "@/lib/validation";

export async function completeMemberSetup(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const requestOrigin = (await headers()).get("origin");
  const origin = appOrigin();
  if (!origin || (requestOrigin && requestOrigin !== origin))
    return { error: true, message: "Account setup could not be verified." };
  const password = z.string().min(12).max(128).safeParse(form.get("password"));
  if (!password.success || password.data !== form.get("confirm_password"))
    return { error: true, message: "Use matching passwords of 12–128 characters." };
  const { client, user } = await requireUser();
  const { data: membership, error } = await client
    .from("memberships")
    .select("organization_id,lifecycle,password_change_required,credential_expires_at")
    .eq("user_id", user.id)
    .in("lifecycle", ["provisioned", "setup_required"])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (
    error ||
    !membership ||
    !["provisioned", "setup_required"].includes(membership.lifecycle) ||
    !membership.password_change_required ||
    !membership.credential_expires_at ||
    Date.parse(membership.credential_expires_at) <= Date.now()
  )
    return {
      error: true,
      message:
        "Your temporary access has expired or is unavailable. Ask your organization owner to review your setup.",
    };
  const updated = await client.auth.updateUser({ password: password.data });
  if (updated.error)
    return {
      error: true,
      message: "Your password could not be updated. Choose a different strong password and retry.",
    };
  const activated = await client.rpc("complete_member_setup", {
    org_id: membership.organization_id,
  });
  if (activated.error)
    return {
      error: true,
      message:
        "Your password changed but organization activation is not complete. Access remains blocked; ask your owner to review your setup.",
    };
  await client.auth.signOut({ scope: "global" });
  redirect("/login?notice=member-setup-complete");
}
