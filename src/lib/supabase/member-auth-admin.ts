import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/config";
import type { MemberAuthProvider } from "@/lib/member-provisioning";

/** Narrow Auth-only adapter. Never expose a privileged database client. */
export function createMemberAuthProvider(): MemberAuthProvider | null {
  const config = supabaseConfig();
  const key = process.env.SUPABASE_AUTH_ADMIN_KEY;
  if (!config || !key || !(key.startsWith("sb_secret_") || key.split(".").length === 3))
    return null;
  const admin = createClient(config.url, key, {
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
