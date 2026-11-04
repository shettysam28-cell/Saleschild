"use client";
import { useActionState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { loginAction, registerAction, forgotAction, resetAction } from "@/app/(auth)/actions";
const modes = {
  login: { action: loginAction, button: "Welcome back" },
  register: { action: registerAction, button: "Create your account" },
  forgot: { action: forgotAction, button: "Send reset link" },
  reset: { action: resetAction, button: "Set new password" },
};
export function AuthForm({
  mode,
  available,
  next,
}: {
  mode: keyof typeof modes;
  available: boolean;
  next?: string;
}) {
  const [state, action, pending] = useActionState(modes[mode].action, {});
  return (
    <form action={action} className="auth-form">
      {mode === "login" && <input type="hidden" name="next" value={next ?? "/app"} />}
      {mode !== "reset" && (
        <label className="form-field">
          Work email
          <input
            name="email"
            type="email"
            placeholder="you@organization.com"
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
      )}
      {mode !== "forgot" && (
        <label className="form-field">
          <span className="password-label">
            {mode === "reset" ? "New password" : "Password"}
            {mode === "login" && <Link href="/forgot-password">Forgot password?</Link>}
          </span>
          <input
            name="password"
            type="password"
            aria-label={mode === "reset" ? "New password" : "Password"}
            aria-describedby={mode !== "login" ? "password-help" : undefined}
            placeholder={mode === "login" ? "Your password" : "At least 12 characters"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "login" ? 1 : 12}
            maxLength={128}
          />
          {mode !== "login" && (
            <span className="form-help" id="password-help">
              Use a unique password with at least 12 characters.
            </span>
          )}
        </label>
      )}
      {state.message && (
        <div
          className="form-message"
          role={state.error ? "alert" : "status"}
          data-error={state.error}
        >
          {state.message}
        </div>
      )}
      <button
        className="button button-dark"
        type="submit"
        disabled={pending || !available || state.success}
      >
        {pending ? "One moment…" : modes[mode].button}
        <ArrowUpRight size={16} />
      </button>
    </form>
  );
}
