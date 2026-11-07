import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { assertDevelopmentDeployment, developmentDeployment } from "./development-deployment.mjs";
// The Next.js hosting adapter copies local environment files into its server bundle.
// Production builds must use the host's environment management exclusively.
export async function checkDeploymentInputs({
  env = process.env,
  fileExists = existsSync,
  fetcher = fetch,
} = {}) {
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"])
    assert(!fileExists(name), "Remove local environment files before packaging a deployment.");
  for (const name of ["APP_URL", "NEXT_PUBLIC_SUPABASE_URL"])
    assert(
      env[name] && new URL(env[name]).protocol === "https:",
      `${name} requires an HTTPS origin in host environment management.`,
    );
  assert(
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_"),
    "Configure the Supabase publishable key in host environment management.",
  );
  assert(
    env.RESEND_SENDING_ENABLED !== "true",
    "Email delivery must remain disabled for this release.",
  );
  if (env.SITE_ID === developmentDeployment.siteId) {
    assertDevelopmentDeployment(env);
    // Publishable keys are opaque: checking their prefix cannot establish which
    // project issued them. Validate against the fixed DEVELOPMENT gateway only.
    let response;
    try {
      response = await fetcher(`${developmentDeployment.supabaseUrl}/auth/v1/settings`, {
        headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error("Development Supabase key validation is unavailable. Deployment is held.");
    }
    assert(response.status === 200, "Development Supabase rejected its configured public key.");
  }
  return "Deployment inputs verified: hosted configuration present; local environment files excluded; email disabled.";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(await checkDeploymentInputs());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
