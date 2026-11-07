import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  provisionMemberWithProvider,
  resetMemberWithProvider,
  type MemberAuthProvider,
  type MemberProvisioningStore,
} from "../_shared/member-provisioning-core.ts";

export const developmentProjectUrl = "https://ebablvrbqbyctzzzmigc.supabase.co";
const allowedOrigins = new Set([
  "https://saleschild-development.netlify.app",
  "https://deploy-preview-10--saleschild-development.netlify.app",
  "https://feature-issue-8-phase-2-2--saleschild-development.netlify.app",
]);
const common = { organizationId: z.uuid(), operationId: z.uuid() };
const payload = z.discriminatedUnion("action", [
  z.strictObject({
    ...common,
    action: z.literal("provision"),
    name: z.string().trim().min(1).max(100),
    email: z.email().trim().toLowerCase().max(254),
  }),
  z.strictObject({ ...common, action: z.literal("reset"), userId: z.uuid() }),
]);
export type DevelopmentMemberOperation = z.infer<typeof payload>;
export type EdgeConfiguration = {
  url: string;
  publicKey: string;
  adminKey: string;
  enabled: boolean;
};
const safeHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
function reply(status: number, message: string) {
  return new Response(JSON.stringify({ success: false, message }), {
    status,
    headers: safeHeaders,
  });
}
async function boundedBody(request: Request) {
  if (Number(request.headers.get("content-length")) > 4096) throw new Error("Oversize");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 4096) {
      await reader.cancel();
      throw new Error("Oversize");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
function providerFor(client: SupabaseClient): MemberAuthProvider {
  const admin = client.auth.admin;
  return {
    async create(request, passcode) {
      const { data, error } = await admin.createUser({
        email: request.email,
        password: passcode,
        email_confirm: false,
        app_metadata: { saleschild_provisioning_id: request.operationId },
      });
      if (error)
        return { outcome: [400, 422].includes(error.status ?? 0) ? "not-created" : "uncertain" };
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
function storeFor(client: SupabaseClient, operationId: string): MemberProvisioningStore {
  async function rpc(name: string, args: Record<string, string>) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error("Member operation unavailable");
    return data;
  }
  return {
    async reserve(request) {
      return (
        (
          await rpc("reserve_member", {
            org_id: request.organizationId,
            operation_id: request.operationId,
            member_email: request.email,
            member_name: request.name,
          })
        )?.created === true
      );
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
    async beginReset(org, member) {
      const result = await rpc("begin_edge_member_reset", {
        org_id: org,
        member_id: member,
        operation_id: operationId,
      });
      if (!z.uuid().safeParse(result).success) throw new Error("Reset already requested");
      return result as string;
    },
    async finishReset(org, member) {
      await rpc("finalize_edge_member_reset", {
        org_id: org,
        member_id: member,
        operation_id: operationId,
      });
    },
  };
}
/** Keys are injected only by the Supabase runtime. The admin client never queries tenant tables. */
export function createMemberAdminHandler(config: EdgeConfiguration, clientFactory = createClient) {
  return async (request: Request): Promise<Response> => {
    if (config.url !== developmentProjectUrl || !config.publicKey || !config.adminKey)
      return reply(503, "Development configuration unavailable.");
    if (request.method !== "POST") return reply(405, "POST required.");
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigins.has(origin)) return reply(403, "Request denied.");
    const authorization = request.headers.get("authorization");
    if (!authorization || !/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(authorization))
      return reply(401, "Authentication required.");
    if (
      request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
    )
      return reply(415, "JSON required.");
    let operation: DevelopmentMemberOperation;
    try {
      operation = payload.parse(await boundedBody(request));
    } catch {
      return reply(400, "Invalid member request.");
    }
    try {
      const options = {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      };
      const caller = clientFactory(config.url, config.publicKey, {
        ...options,
        global: {
          headers: { Authorization: authorization },
          fetch: (input, init) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(15000), redirect: "error" }),
        },
      });
      // Live Auth verification: never authorize decoded claims or user_metadata.
      const { data: identity, error: authError } = await caller.auth.getUser(
        authorization.slice(7),
      );
      if (authError || !identity.user?.email_confirmed_at)
        return reply(401, "Verified authentication required.");
      const { data: membership, error: membershipError } = await caller
        .from("memberships")
        .select("role,lifecycle,password_change_required,revoked_at")
        .eq("organization_id", operation.organizationId)
        .eq("user_id", identity.user.id)
        .maybeSingle();
      if (
        membershipError ||
        membership?.role !== "owner" ||
        membership.lifecycle !== "active" ||
        membership.password_change_required ||
        membership.revoked_at
      )
        return reply(403, "Owner access required.");
      const { data: current, error: sessionError } = await caller.rpc("workspace_session_current", {
        org_id: operation.organizationId,
      });
      if (sessionError || current !== true) return reply(403, "Fresh workspace session required.");
      if (!config.enabled) return reply(503, "Development provisioning is disabled.");
      const privileged = clientFactory(config.url, config.adminKey, {
        ...options,
        global: {
          fetch: (input, init) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(15000), redirect: "error" }),
        },
      });
      const provider = providerFor(privileged);
      const store = storeFor(caller, operation.operationId);
      const result =
        operation.action === "provision"
          ? await provisionMemberWithProvider(operation, provider, store)
          : await resetMemberWithProvider(
              operation.organizationId,
              operation.userId,
              provider,
              store,
            );
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 409,
        headers: safeHeaders,
      });
    } catch {
      return reply(
        409,
        "The member operation could not be confirmed. Check limits and request status before retrying; reconciliation may be required.",
      );
    }
  };
}
