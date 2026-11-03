import { AuthPage } from "@/components/auth-page";
export const metadata = { title: "New password" };
export default async function Reset({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  return <AuthPage mode="reset" notice={(await searchParams).notice} />;
}
