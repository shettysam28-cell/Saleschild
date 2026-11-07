import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import {
  developmentMemberBackendConfigured,
  invokeDevelopmentMemberAdmin,
} from "@/lib/supabase/member-edge";
const operation = {
  action: "reset" as const,
  organizationId: "41000000-0000-4000-8000-000000000001",
  operationId: "41000000-0000-4000-8000-000000000002",
  userId: "41000000-0000-4000-8000-000000000003",
};
beforeEach(() => {
  vi.stubEnv("MEMBER_AUTH_BACKEND", "supabase-edge-development");
  vi.stubEnv("SITE_ID", "a017f82c-55f3-48e9-8d36-d0863f0be2ea");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ebablvrbqbyctzzzmigc.supabase.co");
  vi.stubEnv("APP_URL", "https://saleschild-development.netlify.app");
  vi.stubEnv("SUPABASE_AUTH_ADMIN_KEY", "");
  vi.stubEnv("MEMBER_PROVISIONING_ENABLED", "true");
  vi.stubEnv("MEMBER_VERIFICATION_EMAIL_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());
describe("development Edge server transport", () => {
  it.each([
    ["SITE_ID", "1d26223b-029f-41aa-ab43-0aed4f2c45e3"],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://pmthueylomurnypbpezn.supabase.co"],
    ["APP_URL", "https://saleschild.netlify.app"],
    ["SUPABASE_AUTH_ADMIN_KEY", "fictional-private-value"],
    ["MEMBER_AUTH_BACKEND", "direct-admin"],
  ])("rejects an unsafe deployment binding %s", async (name, value) => {
    vi.stubEnv(name, value);
    expect(developmentMemberBackendConfigured()).toBe(false);
    const invoke = vi.fn();
    await expect(
      invokeDevelopmentMemberAdmin(
        { functions: { invoke } } as unknown as SupabaseClient,
        operation,
      ),
    ).rejects.toThrow("disabled");
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(["MEMBER_PROVISIONING_ENABLED", "MEMBER_VERIFICATION_EMAIL_ENABLED"])(
    "requires explicit activation %s",
    async (name) => {
      vi.stubEnv(name, "false");
      const invoke = vi.fn();
      await expect(
        invokeDevelopmentMemberAdmin(
          { functions: { invoke } } as unknown as SupabaseClient,
          operation,
        ),
      ).rejects.toThrow("disabled");
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it("transports the operation once and validates the credential response", async () => {
    const data = { success: true, message: "Copy once", temporaryPasscode: "F".repeat(32) };
    const invoke = vi.fn().mockResolvedValue({ data, error: null });
    expect(
      await invokeDevelopmentMemberAdmin(
        { functions: { invoke } } as unknown as SupabaseClient,
        operation,
      ),
    ).toEqual(data);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("development-member-admin", { body: operation });
  });
  it.each([
    { data: null, error: { message: "private-provider-detail" } },
    { data: { success: true, message: "Missing credential" }, error: null },
    {
      data: { success: false, message: "Failure", temporaryPasscode: "F".repeat(32) },
      error: null,
    },
    {
      data: { success: true, message: "Invalid credential", temporaryPasscode: "bad" },
      error: null,
    },
  ])(
    "does not retry or expose credentials from ambiguous/invalid responses %j",
    async (response) => {
      const invoke = vi.fn().mockResolvedValue(response);
      const result = await invokeDevelopmentMemberAdmin(
        { functions: { invoke } } as unknown as SupabaseClient,
        operation,
      );
      expect(result.success).toBe(false);
      expect(result.temporaryPasscode).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("private-provider-detail");
      expect(invoke).toHaveBeenCalledTimes(1);
    },
  );
});
