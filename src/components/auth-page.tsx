import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { supabaseConfig, appOrigin } from "@/lib/config";
const content = {
  login: {
    eyebrow: "YOUR NEXT CHAPTER CONTINUES",
    title: "Good to see you.",
    description: "Log in to your Saleschild workspace.",
  },
  register: {
    eyebrow: "LET’S GROW SOMETHING GREAT",
    title: "It starts with you.",
    description: "Create your organization owner account. Members receive access from their owner.",
  },
  forgot: {
    eyebrow: "A FRESH START",
    title: "Find your way back.",
    description: "We’ll help you reset your password securely.",
  },
  reset: {
    eyebrow: "A NEW BEGINNING",
    title: "Make it yours.",
    description: "Choose a new password for your account.",
  },
};
export function AuthPage({
  mode,
  notice,
  next,
}: {
  mode: keyof typeof content;
  notice?: string;
  next?: string;
}) {
  const info = content[mode];
  const available = !!supabaseConfig() && !!appOrigin();
  return (
    <>
      <div className="auth-heading">
        <div className="eyebrow">{info.eyebrow}</div>
        <h1>{info.title}</h1>
        <p>{info.description}</p>
      </div>
      {!available && (
        <div className="auth-availability" role="status">
          Customer access is being prepared. In the meantime,{" "}
          <Link href="/demo">explore the interactive demo</Link> or{" "}
          <Link href="/contact">contact us</Link>.
        </div>
      )}
      {notice === "password-updated" && (
        <div className="form-message" role="status">
          Your password has been updated. Log in with your new password.
        </div>
      )}
      {notice === "member-setup-complete" && (
        <div className="form-message" role="status">
          Your password and member setup are complete. Sign in with your new password to open your
          learning workspace.
        </div>
      )}
      {notice === "fresh-login-required" && (
        <div className="form-message" role="status">
          For your security, sign in again with your current password. Previous sessions cannot
          access your organization.
        </div>
      )}
      {notice === "invalid-link" && (
        <div className="form-message" data-error="true" role="alert">
          This link is invalid or has expired. Request a new one.
        </div>
      )}
      <AuthForm mode={mode} available={available} next={next} />
      <div className="auth-switch">
        {mode === "login" ? (
          <>
            Creating an organization? <Link href="/register">Register as an owner</Link>
          </>
        ) : mode === "register" ? (
          <>
            Already have an account? <Link href="/login">Log in</Link>
          </>
        ) : (
          <Link href="/login">Back to login</Link>
        )}
      </div>
      <p className="auth-privacy">
        Your organization’s knowledge deserves a thoughtful home.
        <br />
        <Link href="/privacy">Read our privacy notice</Link>
      </p>
    </>
  );
}
