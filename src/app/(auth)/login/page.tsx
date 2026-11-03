import { AuthPage } from "@/components/auth-page";
export const metadata = { title: "Log in" };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;
  return <AuthPage mode="login" notice={notice} />;
}
