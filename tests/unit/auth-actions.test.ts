import { beforeEach, describe, expect, it, vi } from "vitest";
const { create, origin, requestOrigin, auth } = vi.hoisted(() => ({
  create: vi.fn(),
  origin: vi.fn(),
  requestOrigin: vi.fn(),
  auth: {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: create }));
vi.mock("@/lib/config", () => ({ appOrigin: origin }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: requestOrigin }) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
import {
  registerAction,
  loginAction,
  forgotAction,
  resetAction,
  signOutAction,
} from "../../src/app/(auth)/actions";
function form(password = "A unique fictional test passphrase") {
  const f = new FormData();
  f.set("email", "learner@example.test");
  f.set("password", password);
  return f;
}
beforeEach(() => {
  vi.clearAllMocks();
  origin.mockReturnValue("https://saleschild.example");
  requestOrigin.mockReturnValue("https://saleschild.example");
  create.mockResolvedValue({ auth });
  for (const fn of Object.values(auth)) fn.mockResolvedValue({ error: null });
  auth.getUser.mockResolvedValue({
    data: { user: { id: "test", email_confirmed_at: "2026-01-01" } },
    error: null,
  });
});
describe("Supabase authentication action contracts (mocked provider)", () => {
  it("registers with the canonical confirmation redirect and does not sign in automatically", async () => {
    expect((await registerAction({}, form())).success).toBe(true);
    expect(auth.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(
      "https://saleschild.example/auth/callback",
    );
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
  it("rejects weak passwords and foreign origins before contacting authentication", async () => {
    expect((await registerAction({}, form("short"))).error).toBe(true);
    requestOrigin.mockReturnValue("https://foreign.example");
    expect((await loginAction({}, form())).error).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
  it("fails closed when canonical configuration is missing", async () => {
    origin.mockReturnValue(null);
    expect((await loginAction({}, form())).error).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
  it("handles expired or unconfirmed login without exposing provider diagnostics", async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: { message: "private provider diagnostic" },
    });
    const result = await loginAction({}, form());
    expect(result.error).toBe(true);
    expect(result.message).toContain("confirm your email");
    expect(result.message).not.toContain("diagnostic");
  });
  it("redirects a successful sign-in to the protected workspace", async () => {
    await expect(loginAction({}, form())).rejects.toThrow("redirect:/app");
  });
  it("uses the canonical recovery redirect and gives an enumeration-resistant response", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: { message: "not found" } });
    const result = await forgotAction({}, form());
    expect(result.message).toContain("If an account exists");
    expect(auth.resetPasswordForEmail.mock.calls[0][1]).toEqual({
      redirectTo: "https://saleschild.example/auth/callback?next=/reset-password",
    });
  });
  it("rejects a password reset without a verified server session", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    expect((await resetAction({}, form())).error).toBe(true);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("revokes sessions after a password update and supports explicit logout", async () => {
    await expect(resetAction({}, form())).rejects.toThrow(
      "redirect:/login?notice=password-updated",
    );
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
    await expect(signOutAction()).rejects.toThrow("redirect:/login");
  });
});
