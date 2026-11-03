import { describe, it, expect, afterEach } from "vitest";
import { safeRedirect, supabaseConfig, appOrigin } from "../../src/lib/config";
import { credentialsSchema, knowledgeSchema, organizationSchema } from "../../src/lib/validation";
import { canAdmin, canAuthor } from "../../src/lib/permissions";
import { emailConfig } from "../../src/lib/email/config";
const originalEnv = { ...process.env };
afterEach(() => {
  for (const name of [
    "APP_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});
describe("authentication and configuration boundaries", () => {
  it.each([
    "https://attacker.test",
    "//attacker.test",
    "/\\attacker.test",
    "/app\nLocation: evil",
    "/unknown",
    "/app/../../contact",
    "/app/%2e%2e/contact",
    "/app/%5c%5cattacker.test",
    "/app/%ZZ",
    null,
  ])("rejects unsafe redirect %s", (value) => {
    expect(safeRedirect(value)).toBe("/app");
  });
  it.each(["/app/knowledge", "/onboarding", "/reset-password"])(
    "allows local application target %s",
    (value) => expect(safeRedirect(value)).toBe(value),
  );
  it("fails closed without Supabase configuration", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(supabaseConfig()).toBeNull();
  });
  it("rejects a privileged key where a public key is expected", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "service-role-is-never-valid-here";
    expect(supabaseConfig()).toBeNull();
  });
  it("uses configured canonical origin without paths", () => {
    process.env.APP_URL = "https://saleschild.example/some/path";
    expect(appOrigin()).toBe("https://saleschild.example");
  });
  it("rejects invalid canonical origins", () => {
    process.env.APP_URL = "javascript:alert(1)";
    expect(appOrigin()).toBeNull();
  });
});
describe("customer input validation", () => {
  it("accepts an omitted source and safely rejects malformed sources", () => {
    const input = {
      title: "A useful guide",
      body: "A long enough piece of employee knowledge.",
      status: "draft",
    };
    expect(knowledgeSchema.safeParse({ ...input, source_url: "" }).success).toBe(true);
    expect(knowledgeSchema.safeParse({ ...input, source_url: "broken URL" }).success).toBe(false);
  });
  it("requires strong length for new passwords", () => {
    expect(
      credentialsSchema.safeParse({ email: "employee@example.com", password: "short" }).success,
    ).toBe(false);
    expect(
      credentialsSchema.safeParse({
        email: "employee@example.com",
        password: "a long unique password",
      }).success,
    ).toBe(true);
  });
  it("rejects javascript knowledge sources", () => {
    expect(
      knowledgeSchema.safeParse({
        title: "A useful guide",
        body: "A long enough piece of employee knowledge.",
        source_url: "javascript:alert(1)",
        status: "draft",
      }).success,
    ).toBe(false);
  });
  it("rejects overlong organization names", () => {
    expect(organizationSchema.safeParse({ name: "a".repeat(101) }).success).toBe(false);
  });
  it("does not treat editor or learner as admin", () => {
    expect(canAdmin("editor")).toBe(false);
    expect(canAdmin("learner")).toBe(false);
    expect(canAuthor("learner")).toBe(false);
    expect(canAuthor("editor")).toBe(true);
  });
});
describe("email sending gate", () => {
  it("is disabled by default", () => {
    expect(emailConfig({})).toBeNull();
  });
  it("requires explicit sending enablement", () => {
    expect(
      emailConfig({ RESEND_API_KEY: "test-placeholder", RESEND_FROM: "hello@authorized.example" }),
    ).toBeNull();
  });
  it("rejects the Gmail contact as a sending identity", () => {
    expect(
      emailConfig({
        RESEND_SENDING_ENABLED: "true",
        RESEND_API_KEY: "test-placeholder",
        RESEND_FROM: "private-contact@gmail.com",
      }),
    ).toBeNull();
  });
  it("uses project contact as reply-to with configured sender", () => {
    const config = emailConfig({
      RESEND_SENDING_ENABLED: "true",
      RESEND_API_KEY: "test-placeholder",
      RESEND_FROM: "hello@authorized.example",
    });
    expect(config?.replyTo).toBeUndefined();
    expect(config?.from).toBe("Saleschild <hello@authorized.example>");
  });
});
