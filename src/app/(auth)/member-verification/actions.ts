"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { appOrigin } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/validation";

export async function requestMemberVerification(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const origin = appOrigin();
  if (
    !origin ||
    (await headers()).get("origin") !== origin ||
    process.env.MEMBER_VERIFICATION_EMAIL_ENABLED !== "true"
  )
    return {
      error: true,
      message:
        "Member email verification is awaiting secure setup. Contact your organization owner.",
    };
  const email = z.email().trim().toLowerCase().max(254).safeParse(form.get("email"));
  if (!email.success) return { error: true, message: "Enter your registered work email." };
  const client = await createClient();
  if (!client)
    return {
      error: true,
      message: "Member email verification is unavailable. Contact your organization owner.",
    };
  try {
    // The member explicitly requests this native Supabase confirmation. Creating
    // an account never sends an invitation; this never marks an email verified.
    await client.auth.resend({
      type: "signup",
      email: email.data,
      options: { emailRedirectTo: `${origin}/member-confirmed` },
    });
  } catch {
    /* Do not expose provider responses or whether an account exists. */
  }
  return {
    success: true,
    message:
      "Request received. If your address has an eligible pending account and its confirmation email can be delivered, you will receive instructions. Check your inbox and spam folder. Delivery is not confirmed here. Wait at least a minute before retrying, or contact your owner.",
  };
}
