import "server-only";
import { requireUser, requireWorkspace } from "@/lib/session";
import type { AccountSettingsData, MemberSummary } from "@/lib/member-types";

export function memberProvisioningReadiness() {
  // Preparing the policy is not approval to activate it. This gate deliberately
  // remains closed even if an administrator supplies an Auth key prematurely.
  return {
    available: false,
    reason:
      "New member provisioning is awaiting approved identity verification and secure account setup. No invitation or email will be sent.",
  };
}

export async function getMemberSetupState() {
  const { client, user } = await requireUser();
  const { data: memberships, error } = await client
    .from("memberships")
    .select("lifecycle,password_change_required,credential_expires_at,revoked_at")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(100);
  if (error) throw new Error("Your account setup could not be checked.");
  const active = memberships?.find(
    (m) => m.lifecycle === "active" && !m.password_change_required && !m.revoked_at,
  );
  const pending = memberships?.find(
    (m) => ["provisioned", "setup_required"].includes(m.lifecycle) && !m.revoked_at,
  );
  return {
    active: Boolean(active),
    revoked: !active && !pending && Boolean(memberships?.length),
    ready: Boolean(
      pending?.credential_expires_at && Date.parse(pending.credential_expires_at) > Date.now(),
    ),
  };
}

export async function getAccountSettings(): Promise<AccountSettingsData> {
  const { client, user, organization, role, profile } = await requireWorkspace();
  let members: MemberSummary[] = [];
  let used = 0;
  if (role === "owner") {
    const { data, error } = await client.rpc("list_workspace_members", { org_id: organization.id });
    if (error || !data || !Array.isArray(data.members))
      throw new Error(
        "Member details could not be loaded. Verify the approved database migration.",
      );
    members = data.members as MemberSummary[];
    used = Number(data.seats?.used ?? 0);
  }
  return {
    capturedAt: new Date().toISOString(),
    profile: { displayName: profile.displayName, email: user.email ?? "" },
    members,
    seats: { used, limit: 2 },
    provisioning: memberProvisioningReadiness(),
  };
}
