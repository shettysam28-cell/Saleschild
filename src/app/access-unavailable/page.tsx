import { requireUser } from "@/lib/session";
import { signOutAction } from "@/app/(auth)/actions";
export const dynamic = "force-dynamic";
export const metadata = { title: "Workspace access", robots: { index: false, follow: false } };
export default async function AccessUnavailable() {
  await requireUser();
  return (
    <main id="main" className="onboarding-page">
      <h1>Workspace access is unavailable.</h1>
      <p>
        Your organization membership has been removed. Contact your organization owner if you need
        access restored. Your learning history is retained.
      </p>
      <form action={signOutAction}>
        <button className="button button-dark">Log out</button>
      </form>
    </main>
  );
}
