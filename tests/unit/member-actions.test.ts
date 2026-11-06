import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { workspace, userContext, origin, provider, rpc, insert, update, lookup } = vi.hoisted(
  () => ({
    workspace: vi.fn(),
    userContext: vi.fn(),
    origin: vi.fn(),
    provider: vi.fn(),
    rpc: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    lookup: vi.fn(),
  }),
);
vi.mock("@/lib/session", () => ({ requireWorkspace: workspace, requireUser: userContext }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: origin }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/config", () => ({ appOrigin: () => "https://saleschild.example" }));
vi.mock("@/lib/supabase/member-auth-admin", () => ({ createMemberAuthProvider: provider }));
import {
  provisionMember,
  resetMemberPasscode,
  removeMember,
  updateProfile,
} from "@/app/app/member-actions";
import { memberProvisioningReadiness } from "@/lib/member-management";
const ownerId = "41000000-0000-4000-8000-000000000001";
const memberId = "41000000-0000-4000-8000-000000000002";
const from = vi.fn();
function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
beforeEach(() => {
  vi.resetAllMocks();
  origin.mockReturnValue("https://saleschild.example");
  rpc.mockResolvedValue({ error: null });
  lookup.mockResolvedValue({ data: null, error: null });
  insert.mockResolvedValue({ error: null });
  update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  const chain = { select: () => chain, eq: () => chain, maybeSingle: lookup, insert, update };
  from.mockReturnValue(chain);
  const context = {
    client: { from, rpc },
    user: { id: ownerId, email: "owner@example.test" },
    organization: { id: "trusted-org" },
    role: "owner",
    profile: { displayName: "Owner" },
  };
  workspace.mockResolvedValue(context);
  userContext.mockResolvedValue(context);
});
describe("member lifecycle server action boundary", () => {
  it("keeps new provisioning and resets closed while the owner-attestation policy is only prepared", async () => {
    expect(memberProvisioningReadiness().available).toBe(false);
    const result = await provisionMember(
      {},
      form({ name: "Member", email: "member@example.test", operation_id: memberId }),
    );
    expect(result.error).toBe(true);
    expect(result.message).toContain("verified-email activation");
    expect((await resetMemberPasscode({}, form({ user_id: memberId }))).error).toBe(true);
    expect(provider).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects foreign origins before querying identity or account services", async () => {
    origin.mockReturnValue("https://untrusted.example");
    expect((await removeMember({}, form({ user_id: memberId, confirm: "remove" }))).error).toBe(
      true,
    );
    expect(workspace).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("denies non-owner management independently of the interface", async () => {
    workspace.mockResolvedValue({ role: "learner" });
    expect((await provisionMember({}, form({}))).error).toBe(true);
    expect((await resetMemberPasscode({}, form({ user_id: memberId }))).error).toBe(true);
    expect((await removeMember({}, form({ user_id: memberId, confirm: "remove" }))).error).toBe(
      true,
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requires removal confirmation and passes only trusted tenant scope to the database", async () => {
    expect((await removeMember({}, form({ user_id: memberId }))).error).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    expect(
      (
        await removeMember(
          {},
          form({ user_id: memberId, confirm: "remove", organization_id: "forged" }),
        )
      ).success,
    ).toBe(true);
    expect(rpc).toHaveBeenCalledWith("remove_workspace_member", {
      org_id: "trusted-org",
      member_id: memberId,
    });
  });
  it("stores only the authenticated user's bounded display name and ignores submitted identity fields", async () => {
    expect(
      (
        await updateProfile(
          {},
          form({
            display_name: "  Fictional Owner  ",
            user_id: memberId,
            email: "changed@example.test",
          }),
        )
      ).success,
    ).toBe(true);
    expect(insert).toHaveBeenCalledWith({ user_id: ownerId, display_name: "Fictional Owner" });
    expect((await updateProfile({}, form({ display_name: "x".repeat(101) }))).error).toBe(true);
  });
});
