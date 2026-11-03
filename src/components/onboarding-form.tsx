"use client";
import { useActionState } from "react";
import { createOrganization } from "@/app/onboarding/actions";
export function OnboardingForm() {
  const [state, action, pending] = useActionState(createOrganization, {});
  return (
    <form action={action} className="auth-form">
      <label className="form-field">
        Organization name
        <input
          name="name"
          placeholder="Your organization"
          minLength={2}
          maxLength={100}
          required
          autoComplete="organization"
        />
      </label>
      {state.message && (
        <div className="form-message" data-error={state.error} role="alert">
          {state.message}
        </div>
      )}
      <button className="button button-dark" disabled={pending}>
        {pending ? "Creating your workspace…" : "Create workspace"}
      </button>
    </form>
  );
}
