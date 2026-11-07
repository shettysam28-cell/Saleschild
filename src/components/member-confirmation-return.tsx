"use client";
import Link from "next/link";
import { useEffect } from "react";
export function MemberConfirmationReturn() {
  useEffect(() => {
    // Email confirmation is performed by Supabase. Ignore any returned session;
    // require password sign-in and setup, and remove credentials from the URL.
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);
  return (
    <>
      <div className="auth-heading">
        <h1>Continue your member setup.</h1>
        <p>
          After confirming your email, sign in with your registered email and temporary passcode.
          Workspace access still requires verified email, a new password, and a fresh sign-in. If
          the link expired or confirmation did not finish, request a fresh link below.
        </p>
      </div>
      <Link className="button button-dark" href="/login">
        Sign in to continue
      </Link>
      <p>
        <Link href="/member-verification">Request a fresh verification email</Link>
      </p>
    </>
  );
}
