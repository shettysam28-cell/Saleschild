import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const { outbox, send } = vi.hoisted(() => {
  const outbox: Array<{ message: Record<string, unknown>; key: string }> = [];
  return {
    outbox,
    send: vi.fn(async (message: Record<string, unknown>, options: { idempotencyKey: string }) => {
      if (!outbox.some((e) => e.key === options.idempotencyKey))
        outbox.push({ message, key: options.idempotencyKey });
      return { data: { id: "local-sandbox-message" }, error: null };
    }),
  };
});
vi.mock("server-only", () => ({}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
import { sendWorkspaceWelcome } from "../../src/lib/email/send";
const original = { ...process.env };
const input = {
  to: "test-inbox@example.test",
  organizationName: "Fictional test organization",
  organizationId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
};
beforeEach(() => {
  outbox.length = 0;
  send.mockClear();
  process.env.RESEND_SENDING_ENABLED = "true";
  process.env.RESEND_API_KEY = "local-sandbox-placeholder";
  process.env.RESEND_FROM = "hello@authorized.example";
});
afterEach(() => {
  for (const key of ["RESEND_SENDING_ENABLED", "RESEND_API_KEY", "RESEND_FROM"]) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});
describe("local mail sandbox (no external provider or inbox delivery)", () => {
  it("captures the transactional message and stable idempotency key", async () => {
    expect((await sendWorkspaceWelcome(input)).status).toBe("sent");
    await sendWorkspaceWelcome(input);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].message.text).toContain("Fictional test organization");
    expect(outbox[0].message.to).toBe("test-inbox@example.test");
    expect(outbox[0].key).toBe(`workspace-welcome/${input.organizationId}/${input.userId}`);
  });
  it("captures nothing while sending is disabled", async () => {
    process.env.RESEND_SENDING_ENABLED = "false";
    expect((await sendWorkspaceWelcome(input)).status).toBe("disabled");
    expect(outbox).toHaveLength(0);
  });
  it("returns a safe failure on transport errors", async () => {
    send.mockRejectedValueOnce(new Error("local transport failure"));
    expect((await sendWorkspaceWelcome(input)).status).toBe("failed");
    expect(outbox).toHaveLength(0);
  });
});
