import { existsSync } from "node:fs";
import assert from "node:assert/strict";
// The Next.js hosting adapter copies local environment files into its server bundle.
// Production builds must use the host's environment management exclusively.
for (const name of [".env", ".env.local", ".env.production", ".env.production.local"])
  assert(!existsSync(name), "Remove local environment files before packaging a deployment.");
for (const name of ["APP_URL", "NEXT_PUBLIC_SUPABASE_URL"])
  assert(
    process.env[name] && new URL(process.env[name]).protocol === "https:",
    `${name} requires an HTTPS origin in host environment management.`,
  );
assert(
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_"),
  "Configure the Supabase publishable key in host environment management.",
);
assert(
  process.env.RESEND_SENDING_ENABLED !== "true",
  "Email delivery must remain disabled for this release.",
);
console.log(
  "Deployment inputs verified: hosted configuration present; local environment files excluded; email disabled.",
);
