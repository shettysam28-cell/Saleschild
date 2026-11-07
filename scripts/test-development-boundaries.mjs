import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
// Read-only hosted boundary probes. No account creation, mail or customer data.
const url = "https://ebablvrbqbyctzzzmigc.supabase.co";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert(key?.startsWith("sb_publishable_"), "Provide only the DEVELOPMENT publishable key.");
const evidence = [];
async function check(name, path, init, statuses, checkBody) {
  const response = await fetch(url + path, {
    ...init,
    headers: { apikey: key, ...init?.headers },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  assert(statuses.includes(response.status), `${name}: unexpected HTTP ${response.status}`);
  if (checkBody) checkBody(await response.json());
  else await response.body?.cancel();
  evidence.push({ name, status: "PASS", http: response.status });
}
await check("Native email confirmation required", "/auth/v1/settings", {}, [200], (body) => {
  assert.equal(body.external?.email, true, "Email authentication must be enabled");
  assert.equal(body.mailer_autoconfirm, false, "Email ownership must not be auto-confirmed");
});
const json = { "Content-Type": "application/json" };
await check(
  "Edge rejects anonymous callers",
  "/functions/v1/development-member-admin",
  { method: "POST", headers: json, body: "{}" },
  [401, 403],
);
const forged = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(
    JSON.stringify({
      sub: "41000000-0000-4000-8000-000000000001",
      role: "authenticated",
      exp: 4102444800,
    }),
  ).toString("base64url"),
  "invalid-signature",
].join(".");
await check(
  "Edge rejects forged identity",
  "/functions/v1/development-member-admin",
  { method: "POST", headers: { ...json, Authorization: `Bearer ${forged}` }, body: "{}" },
  [401, 403],
);
const legacyAnon = process.env.DEVELOPMENT_SUPABASE_ANON_KEY;
if (legacyAnon) {
  const claims = JSON.parse(Buffer.from(legacyAnon.split(".")[1], "base64url"));
  assert(
    claims.ref === "ebablvrbqbyctzzzmigc" && claims.role === "anon",
    "Only the development public anonymous key may be used.",
  );
  await check(
    "Edge handler independently denies anonymous JWT",
    "/functions/v1/development-member-admin",
    {
      method: "POST",
      headers: { ...json, Authorization: `Bearer ${legacyAnon}` },
      body: JSON.stringify({
        action: "provision",
        organizationId: "41000000-0000-4000-8000-000000000001",
        operationId: "41000000-0000-4000-8000-000000000002",
        name: "Fictional",
        email: "fictional@example.test",
      }),
    },
    [401],
    (body) => assert.equal(body.message, "Verified authentication required."),
  );
}
const org = "41000000-0000-4000-8000-000000000001";
for (const [name, body] of [
  [
    "reserve_member",
    {
      org_id: org,
      operation_id: org,
      member_email: "fictional@example.test",
      member_name: "Fictional",
    },
  ],
  ["begin_edge_member_reset", { org_id: org, member_id: org, operation_id: org }],
  ["complete_member_setup", { org_id: org }],
])
  await check(
    `Anonymous RPC denied: ${name}`,
    `/rest/v1/rpc/${name}`,
    { method: "POST", headers: json, body: JSON.stringify(body) },
    [401, 403],
    (body) => assert.equal(body.code, "42501", "Expected permission denial, not missing schema"),
  );
await check(
  "Anonymous membership reads denied",
  "/rest/v1/memberships?select=role&limit=1",
  {},
  [401, 403],
);
await check(
  "Private credential schema is not exposed",
  "/rest/v1/member_credentials?select=*&limit=1",
  { headers: { "Accept-Profile": "private" } },
  [406],
  (body) => assert.equal(body.code, "PGRST106"),
);
await check(
  "Auth administrative API denies public credentials",
  "/auth/v1/admin/users",
  {},
  [401, 403],
);
for (const origin of [
  "https://saleschild-development.netlify.app",
  "https://deploy-preview-10--saleschild-development.netlify.app",
]) {
  for (const path of [
    "/",
    "/login",
    "/app",
    "/member-verification",
    "/member-confirmed",
    "/icon.svg",
  ]) {
    const response = await fetch(origin + path, {
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    assert(
      [401, 403].includes(response.status),
      `Staging perimeter failed at ${origin}${path}: HTTP ${response.status}`,
    );
    await response.body?.cancel();
    evidence.push({
      name: `Netlify team-login perimeter: ${origin}${path}`,
      status: "PASS",
      http: response.status,
    });
  }
}
const report = {
  checkedAt: new Date().toISOString(),
  project: "ebablvrbqbyctzzzmigc",
  scope:
    "Hosted anonymous/read-only boundaries only; no authenticated acceptance or email delivery claim",
  results: evidence,
};
await mkdir("test-results", { recursive: true });
await writeFile("test-results/development-boundaries.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
