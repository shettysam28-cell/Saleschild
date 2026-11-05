import { describe, it, expect } from "vitest";
import { selectWorkspaceMembership, type WorkspaceMembership } from "@/lib/membership-routing";
function membership(
  organization_id: string,
  lifecycle = "active",
  access_not_before = 0,
): WorkspaceMembership {
  return {
    organization_id,
    lifecycle,
    access_not_before,
    role: "learner",
    password_change_required: lifecycle === "provisioned",
    revoked_at: lifecycle === "revoked" ? "2026-11-04" : null,
  };
}
describe("trusted workspace lifecycle routing", () => {
  it("prefers a usable active tenant over an older revoked or pending tenant", () => {
    const active = membership("active");
    expect(
      selectWorkspaceMembership(
        [membership("revoked", "revoked"), membership("pending", "provisioned"), active],
        0,
      ),
    ).toBe(active);
  });
  it("prefers a usable current credential over a tenant needing a fresh login", () => {
    const active = membership("active");
    expect(selectWorkspaceMembership([membership("fresh", "active", 100), active], 1)).toBe(active);
  });
  it("preserves pending and removed states instead of owner onboarding", () => {
    const pending = membership("pending", "provisioned");
    expect(selectWorkspaceMembership([membership("revoked", "revoked"), pending], 0)).toBe(pending);
    expect(selectWorkspaceMembership([membership("revoked", "revoked")], 0)?.lifecycle).toBe(
      "revoked",
    );
    expect(selectWorkspaceMembership([], 0)).toBeUndefined();
  });
});
