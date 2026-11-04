import { AuthPage } from "@/components/auth-page";
import { safeRedirect } from "@/lib/config";
export const metadata = { title: "Log in" };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; next?: string }>;
}) {
  const { notice, next } = await searchParams;
  return <AuthPage mode="login" notice={notice} next={safeRedirect(next)} />;
}
