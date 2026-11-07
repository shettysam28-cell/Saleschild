import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { origin, create, resend } = vi.hoisted(() => ({
  origin: vi.fn(),
  create: vi.fn(),
  resend: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: origin }) }));
vi.mock("@/lib/config", () => ({ appOrigin: () => "https://saleschild.example" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: create }));
import { requestMemberVerification } from "@/app/(auth)/member-verification/actions";
const form = () => {
  const f = new FormData();
  f.set("email", "member@example.test");
  return f;
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MEMBER_VERIFICATION_EMAIL_ENABLED", "false");
  origin.mockReturnValue("https://saleschild.example");
  create.mockResolvedValue({ auth: { resend } });
  resend.mockResolvedValue({ data: {}, error: null });
});
describe("explicit member-requested verification", () => {
  it("never sends while the approved verification channel is disabled", async () => {
    expect((await requestMemberVerification({}, form())).error).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(resend).not.toHaveBeenCalled();
  });
  it.each([null, "https://foreign.example"])(
    "rejects an absent or foreign origin %s before any provider request",
    async (value) => {
      vi.stubEnv("MEMBER_VERIFICATION_EMAIL_ENABLED", "true");
      origin.mockReturnValue(value);
      expect((await requestMemberVerification({}, form())).error).toBe(true);
      expect(resend).not.toHaveBeenCalled();
    },
  );
  it("requests only a signup confirmation at the canonical redirect, without creating an account or confirming email itself", async () => {
    vi.stubEnv("MEMBER_VERIFICATION_EMAIL_ENABLED", "true");
    const f = form();
    f.set("redirectTo", "https://foreign.example");
    expect((await requestMemberVerification({}, f)).success).toBe(true);
    expect(resend).toHaveBeenCalledWith({
      type: "signup",
      email: "member@example.test",
      options: { emailRedirectTo: "https://saleschild.example/member-confirmed" },
    });
  });
  it("does not expose account existence, provider errors or claim delivery", async () => {
    vi.stubEnv("MEMBER_VERIFICATION_EMAIL_ENABLED", "true");
    const accepted = await requestMemberVerification({}, form());
    resend.mockResolvedValue({
      data: null,
      error: { message: "Fictional provider identity detail" },
    });
    expect(await requestMemberVerification({}, form())).toEqual(accepted);
    resend.mockRejectedValue(new Error("Fictional connection detail"));
    expect(await requestMemberVerification({}, form())).toEqual(accepted);
    expect(accepted.message).toContain("Delivery is not confirmed");
  });
  it("rejects malformed email before contacting Auth", async () => {
    vi.stubEnv("MEMBER_VERIFICATION_EMAIL_ENABLED", "true");
    const f = form();
    f.set("email", "invalid");
    expect((await requestMemberVerification({}, f)).error).toBe(true);
    expect(resend).not.toHaveBeenCalled();
  });
});
