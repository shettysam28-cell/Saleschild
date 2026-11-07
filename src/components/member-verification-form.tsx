"use client";
import { useActionState, useEffect, useState } from "react";
import { requestMemberVerification } from "@/app/(auth)/member-verification/actions";

export function MemberVerificationForm({ available }: { available: boolean }) {
  const [state, action, pending] = useActionState(requestMemberVerification, {});
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  return (
    <form action={action} className="auth-form" onSubmit={() => setRemaining(60)}>
      <label className="form-field">
        Registered work email
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          disabled={!available || pending}
        />
      </label>
      <p className="form-help">
        Request a confirmation email for the account your owner prepared. This does not create an
        account or automatically send an invitation.
      </p>
      {state.message && <p role={state.error ? "alert" : "status"}>{state.message}</p>}
      <button className="button button-dark" disabled={!available || pending || remaining > 0}>
        {pending
          ? "Requesting verification…"
          : remaining
            ? `Try again in ${remaining}s`
            : "Request verification email"}
      </button>
    </form>
  );
}
