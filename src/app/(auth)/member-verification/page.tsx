import Link from "next/link";
import { MemberVerificationForm } from "@/components/member-verification-form";
import { appOrigin, supabaseConfig } from "@/lib/config";
export const metadata = { title: "Verify member email", referrer: "no-referrer" as const };
export default function MemberVerificationPage() {
  const available =
    process.env.MEMBER_VERIFICATION_EMAIL_ENABLED === "true" &&
    Boolean(appOrigin() && supabaseConfig());
  return (
    <>
      <div className="auth-heading">
        <div className="eyebrow">MEMBER ACCOUNT SETUP</div>
        <h1>Verify your email.</h1>
        <p>
          Use the address your organization owner registered. After confirming it, sign in with the
          temporary passcode, choose a new password, then sign in again to open your learning
          workspace.
        </p>
      </div>
      {!available && (
        <p role="status">
          Member verification is awaiting secure setup. Your owner can help you with access.
        </p>
      )}
      <MemberVerificationForm available={available} />
      <p className="auth-switch">
        <Link href="/login">Back to login</Link>
      </p>
    </>
  );
}
