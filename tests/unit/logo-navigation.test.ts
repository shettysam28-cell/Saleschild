import { beforeEach, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { create, user, workspace } = vi.hoisted(() => ({
  create: vi.fn(),
  user: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: create }));
vi.mock("@/lib/session", () => ({ requireWorkspace: workspace }));
import { GET } from "@/app/home/route";
beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ auth: { getUser: user } });
  user.mockResolvedValue({ data: { user: null }, error: null });
  workspace.mockResolvedValue({ role: "owner" });
});
it("anonymous logo requests resolve to marketing with private no-store redirects", async () => {
  const r = await GET(new Request("https://saleschild.example/home"));
  expect(r.status).toBe(307);
  expect(r.headers.get("location")).toBe("https://saleschild.example/");
  expect(r.headers.get("cache-control")).toContain("no-store");
  expect(workspace).not.toHaveBeenCalled();
});
it("verified authenticated logo requests pass server workspace authorization", async () => {
  user.mockResolvedValue({
    data: { user: { id: "synthetic", email_confirmed_at: "2026-01-01" } },
    error: null,
  });
  const r = await GET(new Request("https://saleschild.example/home"));
  expect(workspace).toHaveBeenCalledOnce();
  expect(r.headers.get("location")).toBe("https://saleschild.example/app");
});
it("unverified and expired identities cannot route to an authorized workspace", async () => {
  for (const identity of [
    { data: { user: { id: "synthetic", email_confirmed_at: null } }, error: null },
    { data: { user: null }, error: { message: "expired" } },
  ]) {
    user.mockResolvedValue(identity);
    expect(
      (await GET(new Request("https://saleschild.example/home"))).headers.get("location"),
    ).toBe("https://saleschild.example/");
  }
  expect(workspace).not.toHaveBeenCalled();
});
it("preserves server onboarding and authorization redirects", async () => {
  user.mockResolvedValue({ data: { user: { email_confirmed_at: "2026-01-01" } }, error: null });
  workspace.mockRejectedValue(Error("redirect:/onboarding"));
  await expect(GET(new Request("https://saleschild.example/home"))).rejects.toThrow(
    "redirect:/onboarding",
  );
});
