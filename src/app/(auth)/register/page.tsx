import { AuthPage } from "@/components/auth-page";
export const metadata = { title: "Create your account" };
export default function Register() {
  return <AuthPage mode="register" />;
}
