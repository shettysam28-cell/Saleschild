import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("@/lib/supabase/server", () => ({ createClient: create }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
import { requireUser, requireWorkspace } from "@/lib/session";
const member = {
  organization_id: "org",
  role: "learner",
  lifecycle: "active",
  password_change_required: false,
  revoked_at: null,
  access_not_before: 0,
};
let memberships: unknown[], preparing: boolean;
const getUser = vi.fn(),
  getClaims = vi.fn(),
  rpc = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  memberships = [member];
  preparing = false;
  getUser.mockResolvedValue({
    data: { user: { id: "user", email: "learner@example.test", email_confirmed_at: "2026-11-04" } },
    error: null,
  });
  getClaims.mockResolvedValue({ data: { claims: { iat: 100 } }, error: null });
  rpc.mockImplementation(async (name: string) => ({
    data: name === "member_preparation_status" ? preparing : true,
    error: null,
  }));
  create.mockResolvedValue({
    auth: { getUser, getClaims },
    rpc,
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: async () => ({ data: memberships, error: null }),
        single: async () => ({ data: { id: "org", name: "Fictional Org" }, error: null }),
        maybeSingle: async () => ({
          data: { display_name: table === "profiles" ? "Fictional Member" : null },
          error: null,
        }),
      };
      return chain;
    },
  });
});
describe("live server workspace session resolution", () => {
  it("requires independently confirmed email before membership access", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "user", email_confirmed_at: null } },
      error: null,
    });
    await expect(requireUser()).rejects.toThrow("redirect:/login");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("prefers a valid active tenant over older revoked membership", async () => {
    memberships = [
      { ...member, organization_id: "old", lifecycle: "revoked", revoked_at: "2026-11-04" },
      member,
    ];
    const workspace = await requireWorkspace();
    expect(workspace.organization.id).toBe("org");
    expect(workspace.profile.displayName).toBe("Fictional Member");
  });
  it("routes pending and removed members without owner onboarding", async () => {
    memberships = [{ ...member, lifecycle: "provisioned", password_change_required: true }];
    await expect(requireWorkspace()).rejects.toThrow("redirect:/member-setup");
    memberships = [{ ...member, lifecycle: "revoked", revoked_at: "2026-11-04" }];
    await expect(requireWorkspace()).rejects.toThrow("redirect:/access-unavailable");
  });
  it("keeps an orphaned provisioning identity in preparation even before membership attachment", async () => {
    memberships = [];
    preparing = true;
    await expect(requireWorkspace()).rejects.toThrow("redirect:/member-setup");
    preparing = false;
    await expect(requireWorkspace()).rejects.toThrow("redirect:/onboarding");
  });
  it("rejects fresh JWTs belonging to a prior Auth session", async () => {
    memberships = [{ ...member, access_not_before: 99 }];
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(requireWorkspace()).rejects.toThrow("redirect:/login?notice=fresh-login-required");
    expect(rpc).toHaveBeenCalledWith("workspace_session_current", { org_id: "org" });
  });
});
