import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/config";
import type { MemberAuthProvider } from "@/lib/member-provisioning";
import { workspaceFetch } from "./request";

function configuredAdminKey() {
  const key = process.env.SUPABASE_AUTH_ADMIN_KEY;
  if (!key) return null;
  if (key.startsWith("sb_secret_") && key.length > 24) return key;
  try {
    const parts = key.split(".");
    if (
      parts.length === 3 &&
      JSON.parse(Buffer.from(parts[1], "base64url").toString()).role === "service_role"
    )
      return key;
  } catch {
    /* Invalid server configuration remains unavailable. */
  }
  return null;
}
export function memberAuthAdminConfigured() {
  return Boolean(supabaseConfig() && configuredAdminKey());
}

/** Narrow Auth-only adapter. Never expose a privileged database client. */
export function createMemberAuthProvider(): MemberAuthProvider | null {
  const config = supabaseConfig();
  const key = configuredAdminKey();
  if (!config || !key) return null;
  const admin = createClient(config.url, key, {
    global: { fetch: workspaceFetch },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  }).auth.admin;
  return {
    async create(request, passcode) {
      const { data, error } = await admin.createUser({
        email: request.email,
        password: passcode,
        email_confirm: false,
        app_metadata: { saleschild_provisioning_id: request.operationId },
      });
      if (error)
        return {
          outcome: error.status === 422 || error.status === 400 ? "not-created" : "uncertain",
        };
      return data.user ? { outcome: "created", userId: data.user.id } : { outcome: "uncertain" };
    },
    async reset(userId, provisioningId, passcode) {
      const { data, error } = await admin.getUserById(userId);
      if (
        error ||
        !data.user ||
        data.user.app_metadata.saleschild_provisioning_id !== provisioningId
      )
        return false;
      const updated = await admin.updateUserById(userId, { password: passcode });
      return !updated.error;
    },
  };
}
