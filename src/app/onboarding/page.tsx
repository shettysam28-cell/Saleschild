import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { OnboardingForm } from "@/components/onboarding-form";
import { requireUser } from "@/lib/session";
export const dynamic = "force-dynamic";
export const metadata = { title: "Create your workspace", robots: { index: false, follow: false } };
export default async function Onboarding() {
  const { client, user } = await requireUser();
  const { data, error } = await client
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1);
  if (error) throw new Error("Workspace access could not be verified.");
  if (data?.length) redirect("/app");
  return (
    <main id="main" className="onboarding-page">
      <Brand />
      <h1>
        A home for your
        <br />
        <em>team’s potential.</em>
      </h1>
      <p>Name your organization to create its private workspace. You’ll be its first owner.</p>
      <OnboardingForm />
    </main>
  );
}
