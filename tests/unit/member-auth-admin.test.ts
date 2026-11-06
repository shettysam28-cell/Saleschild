import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { client, createUser, getUserById, updateUserById } = vi.hoisted(() => ({
  client: vi.fn(),
  createUser: vi.fn(),
  getUserById: vi.fn(),
  updateUserById: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: client }));
import {
  createMemberAuthProvider,
  memberAuthAdminConfigured,
} from "@/lib/supabase/member-auth-admin";
const request = {
  organizationId: "fictional-org",
  operationId: "fictional-operation",
  email: "member@example.test",
  name: "Fictional Member",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_" + "fixture".repeat(6));
  vi.stubEnv("SUPABASE_AUTH_ADMIN_KEY", "");
  client.mockReturnValue({ auth: { admin: { createUser, getUserById, updateUserById } } });
});
describe("narrow server-only member Auth adapter", () => {
  it("rejects missing, malformed, publishable and legacy anonymous credentials", () => {
    for (const key of [
      "",
      "malformed",
      "sb_publishable_" + "fixture".repeat(6),
      "x." + Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url") + ".x",
    ]) {
      vi.stubEnv("SUPABASE_AUTH_ADMIN_KEY", key);
      expect(memberAuthAdminConfigured()).toBe(false);
      expect(createMemberAuthProvider()).toBeNull();
    }
    expect(client).not.toHaveBeenCalled();
  });
  it("creates an unverified identity tagged with the protected operation marker and no invitation", async () => {
    vi.stubEnv("SUPABASE_AUTH_ADMIN_KEY", "sb_secret_" + "fixture".repeat(6));
    createUser.mockResolvedValue({ data: { user: { id: "fictional-member" } }, error: null });
    const provider = createMemberAuthProvider()!;
    expect(await provider.create(request, "fictional-temporary-passcode")).toEqual({
      outcome: "created",
      userId: "fictional-member",
    });
    expect(createUser).toHaveBeenCalledWith({
      email: request.email,
      password: "fictional-temporary-passcode",
      email_confirm: false,
      app_metadata: { saleschild_provisioning_id: request.operationId },
    });
    expect(client.mock.calls[0][2].global.fetch).toBeTypeOf("function");
  });
  it("does not reset an unrelated identity even when given its ID", async () => {
    vi.stubEnv("SUPABASE_AUTH_ADMIN_KEY", "sb_secret_" + "fixture".repeat(6));
    getUserById.mockResolvedValue({
      data: { user: { app_metadata: { saleschild_provisioning_id: "other-operation" } } },
      error: null,
    });
    expect(
      await createMemberAuthProvider()!.reset(
        "fictional-member",
        request.operationId,
        "replacement",
      ),
    ).toBe(false);
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
