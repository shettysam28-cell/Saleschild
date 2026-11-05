import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isRole } from "@/lib/permissions";
import { selectWorkspaceMembership, type WorkspaceMembership } from "@/lib/membership-routing";
export const requireUser = cache(async () => {
  const client = await createClient();
  if (!client) redirect("/login?notice=unavailable");
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user || !user.email_confirmed_at) redirect("/login");
  return { client, user };
});
export const requireWorkspace = cache(async () => {
  const { client, user } = await requireUser();
  const { data: memberships, error } = await client
    .from("memberships")
    .select("organization_id,role,lifecycle,password_change_required,revoked_at,access_not_before")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(100);
  if (error) throw new Error("Workspace access could not be verified.");
  let issuedAt = 0;
  if (memberships?.some((m) => Number(m.access_not_before) > 0)) {
    const claims = await client.auth.getClaims();
    if (!claims.error) issuedAt = Number(claims.data?.claims.iat ?? 0);
  }
  const membership = selectWorkspaceMembership(
    (memberships ?? []) as WorkspaceMembership[],
    issuedAt,
  );
  if (!membership) {
    const preparing = await client.rpc("member_preparation_status");
    if (preparing.error) throw new Error("Your account preparation could not be verified.");
    if (preparing.data) redirect("/member-setup");
    redirect("/onboarding");
  }
  if (!isRole(membership.role)) throw new Error("Invalid workspace role.");
  if (membership.lifecycle === "revoked" || membership.revoked_at) redirect("/access-unavailable");
  if (membership.lifecycle !== "active" || membership.password_change_required)
    redirect("/member-setup");
  if (Number(membership.access_not_before) > issuedAt)
    redirect("/login?notice=fresh-login-required");
  if (Number(membership.access_not_before) > 0) {
    const current = await client.rpc("workspace_session_current", {
      org_id: membership.organization_id,
    });
    if (current.error || current.data !== true) redirect("/login?notice=fresh-login-required");
  }
  const { data: organization, error: orgError } = await client
    .from("organizations")
    .select("id,name")
    .eq("id", membership.organization_id)
    .single();
  if (orgError || !organization) throw new Error("Organization access could not be verified.");
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) throw new Error("Your account details could not be loaded.");
  return {
    client,
    user,
    organization,
    role: membership.role,
    profile: {
      displayName: profile?.display_name || user.email?.split("@")[0] || "Your workspace",
    },
  };
});
