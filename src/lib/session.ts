import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isRole } from "@/lib/permissions";
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
  const { data: membership, error } = await client
    .from("memberships")
    .select("organization_id,role")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Workspace access could not be verified.");
  if (!membership) redirect("/onboarding");
  if (!isRole(membership.role)) throw new Error("Invalid workspace role.");
  const { data: organization, error: orgError } = await client
    .from("organizations")
    .select("id,name")
    .eq("id", membership.organization_id)
    .single();
  if (orgError || !organization) throw new Error("Organization access could not be verified.");
  return { client, user, organization, role: membership.role };
});
