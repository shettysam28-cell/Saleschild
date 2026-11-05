"use client";
import { useActionState } from "react";
import { completeMemberSetup } from "@/app/member-setup/actions";
export function MemberSetupForm() {
  const [state, action, pending] = useActionState(completeMemberSetup, {});
  return (
    <form action={action} className="auth-form">
      <label className="form-field">
        New password
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
      </label>
      <label className="form-field">
        Confirm new password
        <input
          type="password"
          name="confirm_password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
      </label>
      <p className="form-help">
        Use a unique password of at least 12 characters. After setup, sign in again to begin
        learning.
      </p>
      {state.message && <p role="alert">{state.message}</p>}
      <button className="button button-dark" disabled={pending}>
        {pending ? "Securing your account…" : "Save password and activate"}
      </button>
    </form>
  );
}
