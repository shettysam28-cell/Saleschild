import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  provisionMemberWithProvider,
  resetMemberWithProvider,
  type MemberAuthProvider,
  type MemberProvisioningStore,
} from "@/lib/member-provisioning";
const request = {
  organizationId: "org",
  operationId: "operation",
  email: "fictional@example.test",
  name: "Fictional Member",
};
const store: MemberProvisioningStore = {
  reserve: vi.fn(),
  attach: vi.fn(),
  fail: vi.fn(),
  beginReset: vi.fn(),
  finishReset: vi.fn(),
};
const provider: MemberAuthProvider = { create: vi.fn(), reset: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(provider.create).mockResolvedValue({ outcome: "created", userId: "member" });
  vi.mocked(provider.reset).mockResolvedValue(true);
  vi.mocked(store.beginReset).mockResolvedValue("operation");
  vi.mocked(store.reserve).mockResolvedValue(true);
});
describe("protected Auth provisioning saga with local provider", () => {
  it("reserves first, returns a strong passcode once and never sends it to application storage", async () => {
    const result = await provisionMemberWithProvider(request, provider, store);
    expect(result.success).toBe(true);
    expect(result.temporaryPasscode).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(vi.mocked(store.reserve).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(provider.create).mock.invocationCallOrder[0],
    );
    expect(store.attach).toHaveBeenCalledWith(request, "member");
    expect(JSON.stringify(vi.mocked(store.attach).mock.calls)).not.toContain(
      result.temporaryPasscode,
    );
  });
  it("fails before Auth calls when the two-seat reservation fails", async () => {
    vi.mocked(store.reserve).mockRejectedValue(new Error("Both seats used"));
    await expect(provisionMemberWithProvider(request, provider, store)).rejects.toThrow(
      /Both seats/,
    );
    expect(provider.create).not.toHaveBeenCalled();
  });
  it("does not reset or delete existing identities when creation is rejected", async () => {
    vi.mocked(provider.create).mockResolvedValue({ outcome: "not-created" });
    const result = await provisionMemberWithProvider(request, provider, store);
    expect(result.success).toBe(false);
    expect(result.temporaryPasscode).toBeUndefined();
    expect(store.fail).toHaveBeenCalledWith(request);
    expect(provider.reset).not.toHaveBeenCalled();
  });
  it("retains reservations on an unknown Auth outcome instead of releasing a potentially occupied seat", async () => {
    vi.mocked(provider.create).mockRejectedValue(new Error("network interrupted"));
    const result = await provisionMemberWithProvider(request, provider, store);
    expect(result.message).toContain("reconciliation");
    expect(result.temporaryPasscode).toBeUndefined();
    expect(store.fail).not.toHaveBeenCalled();
    expect(store.attach).not.toHaveBeenCalled();
  });
  it("never reruns Auth creation on a repeated uncertain or already completed operation", async () => {
    vi.mocked(store.reserve).mockResolvedValue(false);
    const result = await provisionMemberWithProvider(request, provider, store);
    expect(result.success).toBe(false);
    expect(result.temporaryPasscode).toBeUndefined();
    expect(provider.create).not.toHaveBeenCalled();
    expect(store.fail).not.toHaveBeenCalled();
  });
  it("keeps created identities blocked and never reveals a passcode if database finalization fails", async () => {
    vi.mocked(store.attach).mockRejectedValue(new Error("database unavailable"));
    const result = await provisionMemberWithProvider(request, provider, store);
    expect(result.success).toBe(false);
    expect(result.temporaryPasscode).toBeUndefined();
    expect(store.fail).not.toHaveBeenCalled();
  });
  it("invalidates tenant access before resetting only the recorded provisioned identity", async () => {
    const result = await resetMemberWithProvider("org", "member", provider, store);
    expect(result.success).toBe(true);
    expect(result.temporaryPasscode).toHaveLength(32);
    expect(vi.mocked(store.beginReset).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(provider.reset).mock.invocationCallOrder[0],
    );
    expect(provider.reset).toHaveBeenCalledWith("member", "operation", result.temporaryPasscode);
    expect(store.finishReset).toHaveBeenCalledWith("org", "member");
  });
  it("does not reveal replacement credentials on partial reset failure", async () => {
    vi.mocked(store.finishReset).mockRejectedValue(new Error("database unavailable"));
    const result = await resetMemberWithProvider("org", "member", provider, store);
    expect(result.success).toBe(false);
    expect(result.temporaryPasscode).toBeUndefined();
    expect(result.message).toContain("blocked");
  });
});
