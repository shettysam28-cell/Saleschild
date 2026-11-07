import { describe, expect, it, vi } from "vitest";
import { checkDeploymentInputs } from "../../scripts/check-deployment-inputs.mjs";
import {
  assertDevelopmentDeployment,
  developmentDeployment as target,
} from "../../scripts/development-deployment.mjs";

const env = {
  NODE_ENV: "test" as const,
  NETLIFY: "true",
  SITE_ID: target.siteId,
  CONTEXT: "production",
  BRANCH: target.branch,
  APP_URL: target.origins.production,
  NEXT_PUBLIC_SUPABASE_URL: target.supabaseUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fictional_fixture",
  MEMBER_PROVISIONING_ENABLED: "false",
  MEMBER_VERIFICATION_EMAIL_ENABLED: "false",
  RESEND_SENDING_ENABLED: "false",
  CONTACT_FORM_ENABLED: "false",
};
const noFiles = () => false;

describe("development deployment configuration and credential boundaries", () => {
  it.each(Object.entries(target.origins))(
    "accepts only the exact origin for context %s",
    (context, origin) => {
      const contextualEnv = {
        ...env,
        CONTEXT: context,
        APP_URL: origin,
        ...(context === "deploy-preview"
          ? { BRANCH: "main", HEAD: target.branch, PULL_REQUEST: "true", REVIEW_ID: "10" }
          : {}),
      };
      expect(() => assertDevelopmentDeployment(contextualEnv)).not.toThrow();
      expect(() =>
        assertDevelopmentDeployment({ ...contextualEnv, APP_URL: "https://foreign.test" }),
      ).toThrow("APP_URL must match");
    },
  );
  it.each([
    { HEAD: "main" },
    { HEAD: undefined },
    { REVIEW_ID: "11" },
    { REVIEW_ID: undefined },
    { PULL_REQUEST: "false" },
  ])("rejects an unapproved preview identity %o", (changes) => {
    expect(() =>
      assertDevelopmentDeployment({
        ...env,
        CONTEXT: "deploy-preview",
        APP_URL: target.origins["deploy-preview"],
        BRANCH: "main",
        HEAD: target.branch,
        PULL_REQUEST: "true",
        REVIEW_ID: "10",
        ...changes,
      }),
    ).toThrow("requires PR #10");
  });
  it.each(["", "unknown", "dev", "constructor"])("rejects context %s", (context) => {
    expect(() => assertDevelopmentDeployment({ ...env, CONTEXT: context })).toThrow();
  });
  it.each([
    "MEMBER_PROVISIONING_ENABLED",
    "MEMBER_VERIFICATION_EMAIL_ENABLED",
    "RESEND_SENDING_ENABLED",
    "CONTACT_FORM_ENABLED",
  ])("requires explicit false for %s", (name) => {
    for (const value of [undefined, "", "true", "TRUE"])
      expect(() => assertDevelopmentDeployment({ ...env, [name]: value })).toThrow(
        "must remain disabled",
      );
  });
  it("allows development activation only with the reviewed backend and paired flags", () => {
    const activated = {
      ...env,
      MEMBER_AUTH_BACKEND: "supabase-edge-development",
      MEMBER_PROVISIONING_ENABLED: "true",
      MEMBER_VERIFICATION_EMAIL_ENABLED: "true",
    };
    expect(() => assertDevelopmentDeployment(activated)).not.toThrow();
    expect(() =>
      assertDevelopmentDeployment({ ...activated, MEMBER_VERIFICATION_EMAIL_ENABLED: "false" }),
    ).toThrow("must agree");
    expect(() =>
      assertDevelopmentDeployment({
        ...activated,
        SITE_ID: "1d26223b-029f-41aa-ab43-0aed4f2c45e3",
      }),
    ).toThrow("exact isolated");
    expect(() =>
      assertDevelopmentDeployment({ ...activated, MEMBER_AUTH_BACKEND: "direct-admin" }),
    ).toThrow("reviewed development Edge");
  });
  it.each([
    "SUPABASE_AUTH_ADMIN_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_SECRET_KEY",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_DB_URL",
    "DATABASE_URL",
  ])("rejects privileged setting %s without disclosing its value", (name) => {
    try {
      assertDevelopmentDeployment({ ...env, [name]: "fictional-sensitive-fixture" });
      throw new Error("Expected rejection");
    } catch (error) {
      expect(String(error)).toContain("credentials are prohibited");
      expect(String(error)).not.toContain("fictional-sensitive-fixture");
    }
  });
  it("rejects modern and legacy privileged keys under unexpected names", () => {
    for (const value of [
      "sb_secret_" + "fictional-fixture",
      "x." + Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url") + ".x",
    ])
      expect(() => assertDevelopmentDeployment({ ...env, UNEXPECTED_NAME: value })).toThrow(
        "credentials are prohibited",
      );
  });
  it.each(["SECRETS_SCAN_ENABLED", "SECRETS_SCAN_SMART_DETECTION_ENABLED"])(
    "rejects disabled scanner %s",
    (name) => {
      expect(() => assertDevelopmentDeployment({ ...env, [name]: "false" })).toThrow(
        "retain secret scanning",
      );
    },
  );
  it("checks the opaque publishable key against only the fixed development gateway", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    await expect(checkDeploymentInputs({ env, fileExists: noFiles, fetcher })).resolves.toContain(
      "verified",
    );
    expect(fetcher).toHaveBeenCalledWith(target.supabaseUrl + "/auth/v1/settings", {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  });
  it.each([301, 401, 403, 500])("holds deployment on key validation HTTP %s", async (status) => {
    await expect(
      checkDeploymentInputs({
        env,
        fileExists: noFiles,
        fetcher: async () => new Response(null, { status }),
      }),
    ).rejects.toThrow("rejected its configured public key");
  });
  it("fails closed on network failure without logging provider details", async () => {
    await expect(
      checkDeploymentInputs({
        env,
        fileExists: noFiles,
        fetcher: async () => {
          throw new Error("fictional-sensitive-provider-detail");
        },
      }),
    ).rejects.toThrow("key validation is unavailable");
  });
  it("retains local-file exclusion and prevents a foreign project before network access", async () => {
    const fetcher = vi.fn();
    await expect(
      checkDeploymentInputs({ env, fileExists: (name) => name === ".env.local", fetcher }),
    ).rejects.toThrow("Remove local environment files");
    await expect(
      checkDeploymentInputs({
        env: { ...env, NEXT_PUBLIC_SUPABASE_URL: "https://pmthueylomurnypbpezn.supabase.co" },
        fileExists: noFiles,
        fetcher,
      }),
    ).rejects.toThrow("isolated Supabase project");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retains production input checks without contacting the development project", async () => {
    const production = { ...env, SITE_ID: "1d26223b-029f-41aa-ab43-0aed4f2c45e3" };
    const fetcher = vi.fn();
    await expect(
      checkDeploymentInputs({ env: production, fileExists: noFiles, fetcher }),
    ).resolves.toContain("verified");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      checkDeploymentInputs({
        env: { ...production, RESEND_SENDING_ENABLED: "true" },
        fileExists: noFiles,
        fetcher,
      }),
    ).rejects.toThrow("Email delivery must remain disabled");
  });
});
