import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
const db = new PGlite();
const owner = "11000000-0000-4000-8000-000000000001";
const other = "11000000-0000-4000-8000-000000000002";
const member = "11000000-0000-4000-8000-000000000003";
const admin = "11000000-0000-4000-8000-000000000004";
const unverified = "11000000-0000-4000-8000-000000000005";
const newMember = "11000000-0000-4000-8000-000000000006";
let org: string, otherOrg: string;
let counter = 0;
function operation() {
  return `22000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
}
async function as<T>(id: string | null, run: () => Promise<T>, iat = 4102444800): Promise<T> {
  await db.exec(`begin; set local role ${id ? "authenticated" : "anon"}`);
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [id ?? "", JSON.stringify({ sub: id, iat, session_id: id?.replace(/^11/, "33") })],
  );
  try {
    const result = await run();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
async function reserve(id: string, email = `${id}@example.test`) {
  return as(owner, () =>
    db.query("select public.reserve_member($1,$2,$3,'Fictional learner')", [org, id, email]),
  );
}
async function attach(id: string, user = member) {
  await db.query(
    "update auth.users set raw_app_meta_data=jsonb_build_object('saleschild_provisioning_id',$1::text),email=$2,encrypted_password='initial-provider-hash' where id=$3",
    [id, `${id}@example.test`, user],
  );
  await as(owner, () =>
    db.query("select public.attach_provisioned_member($1,$2,$3)", [org, id, user]),
  );
}
beforeAll(async () => {
  await db.exec(
    "create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text,raw_app_meta_data jsonb default '{}'); create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz not null); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null); alter table storage.objects enable row level security; grant usage on schema storage to authenticated,anon; grant select,insert,update,delete on storage.objects to authenticated,anon;",
  );
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  // Review the proposed DDL locally; it is not applied to any hosted project.
  await db.exec(
    await readFile("supabase/proposals/phase22_member_activation_and_field_labels.sql", "utf8"),
  );
  await db.exec(await readFile("supabase/development/edge_member_reset.sql", "utf8"));
  for (const id of [owner, other, member, admin, unverified, newMember])
    await db.query("insert into auth.users(id,email,email_confirmed_at)values($1,$2,$3)", [
      id,
      `${id}@example.test`,
      [unverified, newMember].includes(id) ? null : "2026-11-04",
    ]);
  for (const id of [owner, other, member, admin, unverified, newMember])
    await db.query("insert into auth.sessions(id,user_id,created_at)values($1,$2,'2050-01-01')", [
      id.replace(/^11/, "33"),
      id,
    ]);
  org = (
    await as(owner, () =>
      db.query<{ id: string }>("select public.create_organization('Member security fixtures') id"),
    )
  ).rows[0].id;
  otherOrg = (
    await as(other, () =>
      db.query<{ id: string }>("select public.create_organization('Other security fixtures') id"),
    )
  ).rows[0].id;
  await db.query(
    "insert into public.memberships(organization_id,user_id,role)values($1,$2,'admin')",
    [org, admin],
  );
});
afterAll(async () => {
  await db.close();
});

describe("development Edge reset leases (isolated database)", () => {
  let request: string;
  it("denies anonymous and foreign-owner claims and private ledger access", async () => {
    await expect(
      as(owner, () =>
        db.query("select public.begin_edge_member_reset($1,$2,$3)", [
          otherOrg,
          member,
          operation(),
        ]),
      ),
    ).rejects.toThrow(/owner access/);
    for (const id of [null, other, admin, unverified])
      await expect(
        as(id, () =>
          db.query("select public.begin_edge_member_reset($1,$2,$3)", [org, member, operation()]),
        ),
      ).rejects.toThrow(/permission denied|owner access/);
    await expect(
      as(owner, () => db.query("select * from private.edge_member_reset_requests")),
    ).rejects.toThrow(/permission denied/);
  });
  it("claims once, expires access immediately, rejects changed requests and concurrent operations", async () => {
    const provision = operation();
    await reserve(provision);
    await attach(provision);
    request = operation();
    const first = await as(owner, () =>
      db.query<{ id: string | null }>("select public.begin_edge_member_reset($1,$2,$3) id", [
        org,
        member,
        request,
      ]),
    );
    expect(first.rows[0].id).toBe(provision);
    expect(
      (
        await as(owner, () =>
          db.query<{ id: string | null }>("select public.begin_edge_member_reset($1,$2,$3) id", [
            org,
            member,
            request,
          ]),
        )
      ).rows[0].id,
    ).toBeNull();
    await expect(
      as(owner, () =>
        db.query("select public.begin_edge_member_reset($1,$2,$3)", [org, newMember, request]),
      ),
    ).rejects.toThrow(/request changed/);
    await expect(
      as(owner, () =>
        db.query("select public.begin_edge_member_reset($1,$2,$3)", [org, member, operation()]),
      ),
    ).rejects.toThrow(/reconciliation/);
    expect(
      (
        await db.query(
          "select credential_expires_at<=now() expired,password_change_required from public.memberships where organization_id=$1 and user_id=$2",
          [org, member],
        )
      ).rows[0],
    ).toEqual({ expired: true, password_change_required: true });
  });
  it("rejects finalization without provider password change or with a wrong/expired claim", async () => {
    await expect(
      as(owner, () =>
        db.query("select public.finalize_edge_member_reset($1,$2,$3)", [org, member, request]),
      ),
    ).rejects.toThrow(/not confirmed/);
    await expect(
      as(owner, () =>
        db.query("select public.finalize_edge_member_reset($1,$2,$3)", [org, member, operation()]),
      ),
    ).rejects.toThrow(/missing, expired/);
    await db.query(
      "update private.edge_member_reset_requests set claimed_at=now()-interval '6 minutes' where id=$1",
      [request],
    );
    await expect(
      as(owner, () =>
        db.query("select public.finalize_edge_member_reset($1,$2,$3)", [org, member, request]),
      ),
    ).rejects.toThrow(/missing, expired/);
    // Uncertain/expired requests retain their lease: no automated password race.
    await expect(
      as(owner, () =>
        db.query("select public.begin_edge_member_reset($1,$2,$3)", [org, member, operation()]),
      ),
    ).rejects.toThrow(/reconciliation/);
  });
  it("finalizes once after trusted provider change, preserves membership and rejects replay", async () => {
    await db.query("update private.edge_member_reset_requests set claimed_at=now() where id=$1", [
      request,
    ]);
    await db.query("update auth.users set encrypted_password='changed-provider-hash' where id=$1", [
      member,
    ]);
    await as(owner, () =>
      db.query("select public.finalize_edge_member_reset($1,$2,$3)", [org, member, request]),
    );
    const rows = (
      await db.query(
        "select lifecycle,password_change_required,credential_expires_at>now() valid from public.memberships where organization_id=$1 and user_id=$2",
        [org, member],
      )
    ).rows;
    expect(rows).toEqual([
      { lifecycle: "setup_required", password_change_required: true, valid: true },
    ]);
    await expect(
      as(owner, () =>
        db.query("select public.finalize_edge_member_reset($1,$2,$3)", [org, member, request]),
      ),
    ).rejects.toThrow(/missing, expired/);
    expect(
      (
        await as(owner, () =>
          db.query<{ id: string | null }>("select public.begin_edge_member_reset($1,$2,$3) id", [
            org,
            member,
            request,
          ]),
        )
      ).rows[0].id,
    ).toBeNull();
  });
});
