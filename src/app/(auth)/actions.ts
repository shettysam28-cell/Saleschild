"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/config";
import { credentialsSchema, type ActionState } from "@/lib/validation";

const unavailable: ActionState = {
  error: true,
  message: "Workspace access is being prepared. Please try again later or contact us.",
};
async function authContext() {
  const origin = appOrigin();
  if (!origin) return null;
  const requestOrigin = (await headers()).get("origin");
  if (requestOrigin && requestOrigin !== origin) return null;
  const client = await createClient();
  return client ? { client, origin } : null;
}
export async function loginAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z
    .object({ email: z.email().max(254), password: z.string().min(1).max(128) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: true, message: "Enter a valid email address and password." };
  const context = await authContext();
  if (!context) return unavailable;
  const { error } = await context.client.auth.signInWithPassword(parsed.data);
  if (error)
    return {
      error: true,
      message: "We couldn’t sign you in. Check your details and confirm your email.",
    };
  redirect("/app");
}
export async function registerAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const parsed = credentialsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error: true,
      message: "Enter a valid email address and a password of 12–128 characters.",
    };
  const context = await authContext();
  if (!context) return unavailable;
  const { error } = await context.client.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${context.origin}/auth/callback` },
  });
  if (error)
    return { error: true, message: "We couldn’t create your account. Please try again later." };
  return {
    success: true,
    message:
      "Check your inbox for your confirmation link. If you already have an account, log in or reset your password.",
  };
}
export async function forgotAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.email().max(254).safeParse(form.get("email"));
  if (!parsed.success) return { error: true, message: "Enter a valid email address." };
  const context = await authContext();
  if (!context) return unavailable;
  await context.client.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${context.origin}/auth/callback?next=/reset-password`,
  });
  return {
    success: true,
    message: "If an account exists for this email, you’ll receive a password reset link shortly.",
  };
}
export async function resetAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.string().min(12).max(128).safeParse(form.get("password"));
  if (!parsed.success) return { error: true, message: "Use a password of 12–128 characters." };
  const context = await authContext();
  if (!context) return unavailable;
  const {
    data: { user },
    error: authError,
  } = await context.client.auth.getUser();
  if (authError || !user)
    return { error: true, message: "Open a fresh password reset link from your inbox." };
  const { error } = await context.client.auth.updateUser({ password: parsed.data });
  if (error)
    return {
      error: true,
      message: "We couldn’t update your password. Please request a new reset link.",
    };
  await context.client.auth.signOut({ scope: "global" });
  redirect("/login?notice=password-updated");
}
export async function signOutAction() {
  const client = await createClient();
  if (client) await client.auth.signOut();
  redirect("/login");
}
