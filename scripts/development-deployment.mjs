import assert from "node:assert/strict";

export const developmentDeployment = Object.freeze({
  siteId: "a017f82c-55f3-48e9-8d36-d0863f0be2ea",
  branch: "feature/issue-8-phase-2-2",
  supabaseUrl: "https://ebablvrbqbyctzzzmigc.supabase.co",
  origins: Object.freeze({
    production: "https://saleschild-development.netlify.app",
    "deploy-preview": "https://deploy-preview-10--saleschild-development.netlify.app",
    "branch-deploy": "https://feature-issue-8-phase-2-2--saleschild-development.netlify.app",
  }),
});

/** SITE_ID is supplied by Netlify; no user-defined development bypass flag. */
export function assertDevelopmentDeployment(env) {
  assert(
    env.NETLIFY === "true" && env.SITE_ID === developmentDeployment.siteId,
    "Development deployment requires the exact isolated Netlify site.",
  );
  assert(
    env.BRANCH === developmentDeployment.branch,
    "Development deployment requires the approved Phase 2.2 branch.",
  );
  const origin = Object.hasOwn(developmentDeployment.origins, env.CONTEXT ?? "")
    ? developmentDeployment.origins[env.CONTEXT]
    : undefined;
  assert(origin && env.APP_URL === origin, "Development context and APP_URL must match.");
  assert(
    env.NEXT_PUBLIC_SUPABASE_URL === developmentDeployment.supabaseUrl,
    "Development deployment requires the isolated Supabase project.",
  );
  assert(
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_"),
    "Development deployment requires a publishable Supabase key.",
  );
  for (const name of [
    "MEMBER_PROVISIONING_ENABLED",
    "MEMBER_VERIFICATION_EMAIL_ENABLED",
    "RESEND_SENDING_ENABLED",
    "CONTACT_FORM_ENABLED",
  ])
    assert(env[name] === "false", "Development provisioning and sending must remain disabled.");
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    assert(
      !/SUPABASE.*(?:ADMIN|SECRET|SERVICE|ACCESS_TOKEN|PASSWORD|DB_URL|DATABASE_URL)/i.test(name) &&
        name !== "DATABASE_URL" &&
        !String(value).startsWith("sb_secret_"),
      "Privileged database/Auth credentials are prohibited in the development Netlify build.",
    );
    // Also reject a legacy service-role credential under an unexpected name.
    try {
      const parts = String(value).split(".");
      if (parts.length === 3) {
        const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
        assert(
          claims.role !== "service_role",
          "Privileged database/Auth credentials are prohibited in the development Netlify build.",
        );
      }
    } catch (error) {
      if (error.code === "ERR_ASSERTION") throw error;
    }
  }
  assert(
    env.SECRETS_SCAN_ENABLED !== "false" && env.SECRETS_SCAN_SMART_DETECTION_ENABLED !== "false",
    "Development deployments must retain secret scanning.",
  );
}
