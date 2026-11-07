import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DevelopmentMemberOperation } from "../../../supabase/functions/development-member-admin/handler";
import type { MemberCredentialResult } from "@/lib/member-provisioning";

export function developmentMemberBackendSelected() {
  return process.env.MEMBER_AUTH_BACKEND === "supabase-edge-development";
}
export function developmentMemberBackendConfigured() {
  return (
    developmentMemberBackendSelected() &&
    process.env.SITE_ID === "a017f82c-55f3-48e9-8d36-d0863f0be2ea" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL === "https://ebablvrbqbyctzzzmigc.supabase.co" &&
    [
      "https://saleschild-development.netlify.app",
      "https://deploy-preview-10--saleschild-development.netlify.app",
      "https://feature-issue-8-phase-2-2--saleschild-development.netlify.app",
    ].includes(process.env.APP_URL ?? "") &&
    !process.env.SUPABASE_AUTH_ADMIN_KEY
  );
}
const responseSchema = z
  .strictObject({
    success: z.boolean(),
    message: z.string().min(1).max(1000),
    temporaryPasscode: z
      .string()
      .regex(/^[A-Za-z0-9_-]{32}$/)
      .optional(),
  })
  .refine((value) => value.success === Boolean(value.temporaryPasscode));
/** Transport only. Edge Auth and tenant-scoped RPCs independently authorize the caller. */
export async function invokeDevelopmentMemberAdmin(
  client: SupabaseClient,
  body: DevelopmentMemberOperation,
): Promise<MemberCredentialResult> {
  if (
    !developmentMemberBackendConfigured() ||
    process.env.MEMBER_PROVISIONING_ENABLED !== "true" ||
    process.env.MEMBER_VERIFICATION_EMAIL_ENABLED !== "true"
  )
    throw new Error("Development member administration is disabled.");
  const { data, error } = await client.functions.invoke("development-member-admin", { body });
  // No retries: a timeout may follow successful Auth creation or password reset.
  const result = responseSchema.safeParse(data);
  if (error || !result.success)
    return {
      success: false,
      message:
        "The member operation could not be confirmed. Review its status before retrying; reconciliation may be required.",
    };
  return result.data;
}
