import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  createMemberAdminHandler,
  developmentProjectUrl,
} from "../../supabase/functions/development-member-admin/handler";
const owner = "41000000-0000-4000-8000-000000000001";
const member = "41000000-0000-4000-8000-000000000002";
const operation = "41000000-0000-4000-8000-000000000003";
const org = "41000000-0000-4000-8000-000000000004";
const token = "fictional-authentication-token-for-unit-tests";
function setup(overrides = {}) {
  const getUser = vi.fn().mockResolvedValue({
    data: { user: { id: owner, email_confirmed_at: "2026-01-01" } },
    error: null,
  });
  const membership = vi.fn().mockResolvedValue({
    data: {
      role: "owner",
      lifecycle: "active",
      password_change_required: false,
      revoked_at: null,
    },
    error: null,
  });
  const chain = { select: () => chain, eq: () => chain, maybeSingle: membership };
  const rpc = vi.fn().mockImplementation(async (name: string) => ({
    data:
      name === "workspace_session_current"
        ? true
        : name === "reserve_member"
          ? { created: true }
          : name === "begin_edge_member_reset"
            ? operation
            : null,
    error: null,
  }));
  const createUser = vi.fn().mockResolvedValue({ data: { user: { id: member } }, error: null });
  const getUserById = vi.fn().mockResolvedValue({
    data: { user: { id: member, app_metadata: { saleschild_provisioning_id: operation } } },
    error: null,
  });
  const updateUserById = vi.fn().mockResolvedValue({ error: null });
  const caller = { auth: { getUser }, from: () => chain, rpc };
  const privileged = { auth: { admin: { createUser, getUserById, updateUserById } } };
  const factory = vi
    .fn()
    .mockImplementation((_url: string, key: string) =>
      key === "public-fixture" ? caller : privileged,
    );
  const handler = createMemberAdminHandler(
    {
      url: developmentProjectUrl,
      publicKey: "public-fixture",
      adminKey: "private-fixture",
      enabled: true,
      ...overrides,
    },
    factory as unknown as typeof createClient,
  );
  return { handler, factory, getUser, membership, rpc, createUser, getUserById, updateUserById };
}
function request(
  body: unknown = {
    action: "provision",
    organizationId: org,
    operationId: operation,
    name: "Fictional member",
    email: "member@example.test",
  },
  headers: Record<string, string> = {},
) {
  return new Request("https://development.example.test/functions/v1/development-member-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
beforeEach(() => vi.restoreAllMocks());
describe("development-only Edge authorization and privileged Auth boundary (mocked)", () => {
  it("rejects another Supabase project before constructing any client", async () => {
    const t = setup({ url: "https://pmthueylomurnypbpezn.supabase.co" });
    expect((await t.handler(request())).status).toBe(503);
    expect(t.factory).not.toHaveBeenCalled();
  });
  it("rejects anonymous, foreign-origin, GET, malformed and oversized requests before privileged calls", async () => {
    const t = setup();
    for (const r of [
      request({}, { Authorization: "" }),
      request({}, { Origin: "https://foreign.example" }),
      new Request("https://example.test"),
      request("{"),
      request("x".repeat(4097)),
      request({}, { "Content-Type": "text/plain" }),
      request({
        action: "provision",
        organizationId: org,
        operationId: operation,
        name: "A",
        email: "a@example.test",
        role: "owner",
      }),
    ]) {
      expect((await t.handler(r)).status).toBeGreaterThanOrEqual(400);
    }
    expect(t.factory).not.toHaveBeenCalled();
  });
  it("rejects a forged or unconfirmed JWT using live getUser", async () => {
    for (const identity of [
      { data: { user: null }, error: { message: "private-provider-detail" } },
      { data: { user: { id: owner, email_confirmed_at: null } }, error: null },
    ]) {
      const t = setup();
      t.getUser.mockResolvedValue(identity);
      const response = await t.handler(request());
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain("private-provider-detail");
      expect(t.factory).toHaveBeenCalledTimes(1);
      expect(t.createUser).not.toHaveBeenCalled();
    }
  });
  it.each([
    null,
    { role: "learner", lifecycle: "active" },
    { role: "owner", lifecycle: "revoked" },
    { role: "owner", lifecycle: "active", password_change_required: true },
    { role: "owner", lifecycle: "active", revoked_at: "2026-01-01" },
  ])("denies missing, cross-tenant or inactive ownership %j", async (data) => {
    const t = setup();
    t.membership.mockResolvedValue({ data, error: null });
    expect((await t.handler(request())).status).toBe(403);
    expect(t.factory).toHaveBeenCalledTimes(1);
  });
  it("checks the trusted database session and retains the runtime kill switch", async () => {
    const t = setup();
    t.rpc.mockResolvedValue({ data: false, error: null });
    expect((await t.handler(request())).status).toBe(403);
    expect(t.createUser).not.toHaveBeenCalled();
    const disabled = setup({ enabled: false });
    expect((await disabled.handler(request())).status).toBe(503);
    expect(disabled.factory).toHaveBeenCalledTimes(1);
  });
  it("reserves through caller RLS, creates unconfirmed Auth and returns a passcode only after attachment", async () => {
    const t = setup();
    const response = await t.handler(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.temporaryPasscode).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(t.getUser).toHaveBeenCalledWith(token);
    expect(t.createUser).toHaveBeenCalledWith({
      email: "member@example.test",
      password: body.temporaryPasscode,
      email_confirm: false,
      app_metadata: { saleschild_provisioning_id: operation },
    });
    expect(t.rpc).toHaveBeenCalledWith("reserve_member", {
      org_id: org,
      operation_id: operation,
      member_email: "member@example.test",
      member_name: "Fictional member",
    });
    expect(t.rpc).toHaveBeenCalledWith("attach_provisioned_member", {
      org_id: org,
      operation_id: operation,
      identity_id: member,
    });
    expect(JSON.stringify(t.rpc.mock.calls)).not.toContain(body.temporaryPasscode);
  });
  it("does not recreate identities on replay or release seats after ambiguous provider failures", async () => {
    const t = setup();
    t.rpc.mockImplementation(async (name: string) => ({
      data: name === "workspace_session_current" ? true : { created: false },
      error: null,
    }));
    expect((await t.handler(request())).status).toBe(409);
    expect(t.createUser).not.toHaveBeenCalled();
    const uncertain = setup();
    uncertain.createUser.mockRejectedValue(new Error("private-provider-detail"));
    const response = await uncertain.handler(request());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.temporaryPasscode).toBeUndefined();
    expect(uncertain.rpc.mock.calls.map((c) => c[0])).not.toContain("fail_member_reservation");
    expect(JSON.stringify(body)).not.toContain("private-provider-detail");
  });
  it("uses a durable reset claim before Auth and finalizes the exact operation", async () => {
    const t = setup();
    const response = await t.handler(
      request({ action: "reset", organizationId: org, operationId: operation, userId: member }),
    );
    expect(response.status).toBe(200);
    expect(t.rpc).toHaveBeenCalledWith("begin_edge_member_reset", {
      org_id: org,
      member_id: member,
      operation_id: operation,
    });
    expect(t.rpc).toHaveBeenCalledWith("finalize_edge_member_reset", {
      org_id: org,
      member_id: member,
      operation_id: operation,
    });
    expect(t.getUserById).toHaveBeenCalledWith(member);
    expect(t.updateUserById).toHaveBeenCalledTimes(1);
  });
  it("never changes a password when reset claim is replayed or the identity marker differs", async () => {
    for (const replay of [true, false]) {
      const t = setup();
      if (replay)
        t.rpc.mockImplementation(async (name: string) => ({
          data: name === "workspace_session_current" ? true : null,
          error: null,
        }));
      else
        t.getUserById.mockResolvedValue({
          data: { user: { app_metadata: { saleschild_provisioning_id: "foreign" } } },
          error: null,
        });
      const response = await t.handler(
        request({ action: "reset", organizationId: org, operationId: operation, userId: member }),
      );
      expect(response.status).toBe(409);
      expect(t.updateUserById).not.toHaveBeenCalled();
      expect((await response.json()).temporaryPasscode).toBeUndefined();
    }
  });
});
