import { AuthPage } from "@/components/auth-page";
export const metadata = { title: "Reset your password" };
export default function Forgot() {
  return <AuthPage mode="forgot" />;
}
