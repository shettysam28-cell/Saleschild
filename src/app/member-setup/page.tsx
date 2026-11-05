import { redirect } from "next/navigation";
import { getMemberSetupState } from "@/lib/member-management";
import { MemberSetupForm } from "@/components/member-setup-form";
import { Brand } from "@/components/brand";
export const dynamic = "force-dynamic";
export const metadata = { title: "Member setup", robots: { index: false, follow: false } };
export default async function MemberSetup() {
  const { active, revoked, ready } = await getMemberSetupState();
  if (active) redirect("/app");
  if (revoked) redirect("/access-unavailable");
  return (
    <main id="main" className="onboarding-page">
      <Brand href="/home" />
      <h1>{ready ? "Make this account yours." : "Your account is being prepared."}</h1>
      <p>
        {ready
          ? "Your email is verified. Replace your temporary passcode before accessing your organization’s learning workspace."
          : "Ask your organization owner to complete your verified account setup. Your knowledge and learning access remain protected."}
      </p>
      {ready && <MemberSetupForm />}
    </main>
  );
}
