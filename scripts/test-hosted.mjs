import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "HOSTED_TEST_A_EMAIL",
  "HOSTED_TEST_A_PASSWORD",
  "HOSTED_TEST_B_EMAIL",
  "HOSTED_TEST_B_PASSWORD",
  "HOSTED_TEST_ORGANIZATION_A_ID",
  "HOSTED_TEST_ORGANIZATION_B_ID",
];
const missing = required.filter((k) => !process.env[k]);
if (process.env.HOSTED_TEST_PROJECT_CONFIRMED !== "development" || missing.length) {
  console.error(
    `BLOCKED: configure a chosen development project, dedicated verified test accounts and HOSTED_TEST_PROJECT_CONFIRMED=development. Missing settings: ${missing.join(", ") || "none"}. No hosted requests made.`,
  );
  process.exit(2);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert(new URL(url).protocol === "https:");
assert(key.startsWith("sb_publishable_"), "Only a publishable project key is permitted.");
const make = () =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const a = make(),
  b = make(),
  anon = make();
const reports = [];
const orgA = process.env.HOSTED_TEST_ORGANIZATION_A_ID,
  orgB = process.env.HOSTED_TEST_ORGANIZATION_B_ID;
assert.notEqual(orgA, orgB);
function okay(result, label) {
  assert(!result.error, `${label} failed; inspect the provider privately.`);
  return result.data;
}
try {
  for (const [client, label] of [
    [a, "A"],
    [b, "B"],
  ]) {
    const signed = await client.auth.signInWithPassword({
      email: process.env[`HOSTED_TEST_${label}_EMAIL`],
      password: process.env[`HOSTED_TEST_${label}_PASSWORD`],
    });
    assert(!signed.error, `Test identity ${label} could not sign in.`);
    assert(signed.data.user?.email_confirmed_at, `Test identity ${label} must be verified.`);
  }
  const accountA = (await a.auth.getUser()).data.user;
  const accountB = (await b.auth.getUser()).data.user;
  assert(accountA && accountB && accountA.id !== accountB.id);
  for (const [client, org] of [
    [a, orgA],
    [b, orgB],
  ]) {
    const data = okay(
      await client.from("organizations").select("id,name").eq("id", org).single(),
      "Fixture organization read",
    );
    assert(
      data.name.startsWith("Saleschild integration"),
      "Writes are allowed only in explicitly named Saleschild integration fixture organizations.",
    );
  }
  const denied = await anon.from("organizations").select("id");
  assert(denied.error || denied.data?.length === 0);
  reports.push("Anonymous organization reads denied");
  assert.equal(
    okay(await b.from("organizations").select("id").eq("id", orgA), "Cross-tenant read").length,
    0,
  );
  reports.push("Cross-tenant organization read denied");
  const title = `Integration draft ${Date.now()}`;
  const row = okay(
    await a
      .from("knowledge_items")
      .insert({
        organization_id: orgA,
        created_by: accountA.id,
        title,
        body: "Dedicated integration fixture. No customer or personal content.",
        status: "draft",
      })
      .select("id,current_version")
      .single(),
    "Draft insert",
  );
  assert.equal(
    okay(await b.from("knowledge_items").select("id").eq("id", row.id), "Cross-tenant draft read")
      .length,
    0,
  );
  const forbidden = await b.from("knowledge_items").insert({
    organization_id: orgA,
    created_by: accountB.id,
    title: "Unauthorized fixture",
    body: "This insert must be rejected by organization policies.",
    status: "draft",
  });
  assert(forbidden.error);
  reports.push("Cross-tenant knowledge read and insert denied");
  okay(
    await a
      .from("knowledge_items")
      .update({ title: `${title} revised` })
      .eq("id", row.id)
      .eq("organization_id", orgA)
      .eq("current_version", row.current_version)
      .select("id")
      .single(),
    "Draft edit",
  );
  const snapshots = okay(
    await a
      .from("knowledge_versions")
      .select("version")
      .eq("knowledge_id", row.id)
      .order("version"),
    "Version history",
  );
  assert.equal(snapshots.length, 2);
  reports.push("Draft persisted and version snapshots preserved");
  const escalation = await a
    .from("memberships")
    .update({ role: "owner" })
    .eq("organization_id", orgB)
    .eq("user_id", accountA.id);
  assert(escalation.error);
  reports.push("Direct membership escalation denied");
  const object = `${orgA}/integration/${Date.now()}.txt`;
  okay(
    await a.storage
      .from("organization-knowledge")
      .upload(object, new Blob(["Dedicated integration fixture"], { type: "text/plain" }), {
        contentType: "text/plain",
        upsert: false,
      }),
    "Private file upload",
  );
  const download = await b.storage.from("organization-knowledge").download(object);
  assert(download.error);
  reports.push("Hosted private Storage upload and cross-tenant download denial verified");
  const audit = okay(
    await a.from("audit_events").select("id").eq("organization_id", orgA).eq("entity_id", row.id),
    "Audit query",
  );
  assert(audit.length >= 2);
  reports.push("Hosted audit events recorded");
  await mkdir("test-results/hosted", { recursive: true });
  await writeFile(
    "test-results/hosted/results.json",
    JSON.stringify(
      {
        scope:
          "Dedicated development fixtures only; not browser Auth, inbox delivery or full security certification",
        checks: reports,
        retainedFixtures: { knowledgeId: row.id, storageObject: object },
        cleanup: "No destructive cleanup performed. Review fixture retention manually.",
      },
      null,
      2,
    ),
  );
  console.log(
    `Hosted development checks passed: ${reports.length}. Dedicated fixtures retained; no destructive cleanup.`,
  );
} catch {
  console.error(
    "Hosted checks FAILED. No credentials or provider response bodies were logged. Dedicated fixture rows/files may remain for authorized review.",
  );
  process.exitCode = 1;
} finally {
  await a.auth.signOut();
  await b.auth.signOut();
}
