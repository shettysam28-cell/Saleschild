import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
const db = new PGlite();
const owner = "11000000-0000-4000-8000-000000000001";
const other = "11000000-0000-4000-8000-000000000002";
const member = "11000000-0000-4000-8000-000000000003";
const admin = "11000000-0000-4000-8000-000000000004";
const unverified = "11000000-0000-4000-8000-000000000005";
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
  for (const id of [owner, other, member, admin, unverified])
    await db.query("insert into auth.users(id,email,email_confirmed_at)values($1,$2,$3)", [
      id,
      `${id}@example.test`,
      id === unverified ? null : "2026-11-04",
    ]);
  for (const id of [owner, other, member, admin, unverified])
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
describe("member provisioning and current-token authorization", () => {
  it("retains legacy active membership and denies anonymous new APIs", async () => {
    expect(
      (await as(owner, () => db.query("select private.membership_role($1) role", [org]))).rows,
    ).toEqual([{ role: "owner" }]);
    await expect(
      as(null, () => db.query("select public.list_workspace_members($1)", [org])),
    ).rejects.toThrow(/permission denied/);
  });
  it("denies administrators and other organizations owner-only management", async () => {
    for (const user of [admin, other, unverified])
      await expect(
        as(user, () =>
          db.query("select public.reserve_member($1,$2,'blocked@example.test','Blocked member')", [
            org,
            operation(),
          ]),
        ),
      ).rejects.toThrow(/owner access/);
    expect(
      (
        await as(admin, () =>
          db.query(
            "update public.organizations set name='Not authorized' where id=$1 returning id",
            [org],
          ),
        )
      ).rows,
    ).toEqual([]);
  });
  it("reserves two pending seats atomically, includes pending accounts and rejects a third", async () => {
    const a = operation(),
      b = operation();
    await reserve(a);
    await reserve(b);
    await reserve(a); // idempotent, consumes no third seat
    await expect(reserve(operation())).rejects.toThrow(/Both member seats/);
    const { rows } = await as(owner, () =>
      db.query<{ result: { seats: { used: number } } }>(
        "select public.list_workspace_members($1) result",
        [org],
      ),
    );
    expect(rows[0].result.seats.used).toBe(2);
    await as(owner, () => db.query("select public.fail_member_reservation($1,$2)", [org, a]));
    await as(owner, () => db.query("select public.fail_member_reservation($1,$2)", [org, b]));
  });
  it("rejects changed retries, duplicate emails and attaching an unrelated Auth identity", async () => {
    const a = operation();
    await reserve(a, "same@example.test");
    await expect(reserve(a, "changed@example.test")).rejects.toThrow(/request changed/);
    await expect(reserve(operation(), "same@example.test")).rejects.toThrow(/duplicate key/);
    await expect(
      as(owner, () =>
        db.query("select public.attach_provisioned_member($1,$2,$3)", [org, a, other]),
      ),
    ).rejects.toThrow(/identity could not be verified/);
    await as(owner, () => db.query("select public.fail_member_reservation($1,$2)", [org, a]));
  });
  it("keeps an uncertain created identity reserved and blocks owner bootstrap through direct APIs", async () => {
    const a = operation();
    await reserve(a);
    await db.query(
      "update auth.users set raw_app_meta_data=jsonb_build_object('saleschild_provisioning_id',$1::text),email_confirmed_at=now() where id=$2",
      [a, unverified],
    );
    expect(
      (await as(unverified, () => db.query("select public.member_preparation_status() preparing")))
        .rows,
    ).toEqual([{ preparing: true }]);
    await expect(
      as(unverified, () => db.query("select public.create_organization('Not a member workspace')")),
    ).rejects.toThrow(/Member account preparation/);
    await expect(
      as(owner, () => db.query("select public.fail_member_reservation($1,$2)", [org, a])),
    ).rejects.toThrow(/reconciliation/);
    await db.query(
      "update auth.users set raw_app_meta_data='{}',email_confirmed_at=null where id=$1",
      [unverified],
    );
    await as(owner, () => db.query("select public.fail_member_reservation($1,$2)", [org, a]));
  });
  it("blocks direct API access and activation until verified password setup", async () => {
    const a = operation();
    await reserve(a);
    await attach(a);
    await db.query(
      "update public.memberships set credential_expires_at=now()-interval '1 minute' where user_id=$1",
      [member],
    );
    await expect(
      as(member, () => db.query("select public.complete_member_setup($1)", [org])),
    ).rejects.toThrow(/Verified password setup/);
    await db.query(
      "update public.memberships set credential_expires_at=now()+interval '48 hours' where user_id=$1",
      [member],
    );
    expect((await as(member, () => db.query("select id from public.organizations"))).rows).toEqual(
      [],
    );
    await expect(
      as(member, () => db.query("select public.complete_member_setup($1)", [org])),
    ).rejects.toThrow(/Verified password setup/);
    await expect(
      as(member, () =>
        db.query("update public.memberships set lifecycle='active' where user_id=$1", [member]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(member, () => db.query("select * from private.member_credentials")),
    ).rejects.toThrow(/permission denied/);
    await db.query(
      "update auth.users set encrypted_password='changed-provider-hash',email_confirmed_at=null where id=$1",
      [member],
    );
    await expect(
      as(member, () => db.query("select public.complete_member_setup($1)", [org])),
    ).rejects.toThrow(/Verified password setup/);
    await db.query("update auth.users set email_confirmed_at=now() where id=$1", [member]);
    await db.query("update auth.sessions set created_at='2000-01-01' where user_id=$1", [member]);
    await expect(
      as(member, () => db.query("select public.complete_member_setup($1)", [org])),
    ).rejects.toThrow(/Verified password setup/);
    await db.query("update auth.sessions set created_at='2050-01-01' where user_id=$1", [member]);
    await as(member, () => db.query("select public.complete_member_setup($1)", [org]));
    expect(
      (await as(member, () => db.query("select id from public.organizations"), 1)).rows,
    ).toEqual([]);
    expect((await as(member, () => db.query("select id from public.organizations"))).rows).toEqual([
      { id: org },
    ]);
    await db.query("update auth.sessions set created_at='2000-01-01' where user_id=$1", [member]);
    expect(
      (await as(member, () => db.query("select id from public.organizations"), 4102444800)).rows,
    ).toEqual([]);
    await db.query("update auth.sessions set created_at='2050-01-01' where user_id=$1", [member]);
    expect(
      (
        await as(member, () =>
          db.query("select id from public.organizations where id=$1", [otherOrg]),
        )
      ).rows,
    ).toEqual([]);
  });
  it("isolates profile updates and owner-only member identity reads", async () => {
    await as(member, () =>
      db.query("update public.profiles set display_name='Member name' where user_id=$1", [member]),
    );
    expect(
      (
        await as(other, () =>
          db.query("select user_id from public.profiles where user_id=$1", [member]),
        )
      ).rows,
    ).toEqual([]);
    await expect(
      as(member, () => db.query("update public.profiles set user_id=$1", [other])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(member, () => db.query("select public.list_workspace_members($1)", [org])),
    ).rejects.toThrow(/owner access/);
    expect(
      (
        await as(owner, () =>
          db.query("select display_name from public.profiles where user_id=$1", [member]),
        )
      ).rows,
    ).toEqual([{ display_name: "Member name" }]);
  });
  it("throttles presence independently from learning and retains first login", async () => {
    await as(member, () => db.query("select public.record_workspace_presence($1)", [org]));
    const before = (
      await db.query<{ first_login_at: string | null; last_seen_at: string | null }>(
        "select first_login_at,last_seen_at from public.memberships where user_id=$1",
        [member],
      )
    ).rows[0];
    await as(member, () => db.query("select public.record_workspace_presence($1)", [org]));
    expect(
      (
        await db.query(
          "select first_login_at,last_seen_at from public.memberships where user_id=$1",
          [member],
        )
      ).rows[0],
    ).toEqual(before);
    expect(before.first_login_at).not.toBeNull();
  });
  it("locks access before reset, cannot finalize unchanged Auth password, and needs setup again", async () => {
    await as(owner, () => db.query("select public.begin_member_reset($1,$2)", [org, member]));
    expect((await as(member, () => db.query("select id from public.organizations"))).rows).toEqual(
      [],
    );
    // A reset must capture a further provider password change before ready.
    await expect(
      as(owner, () => db.query("select public.finalize_member_reset($1,$2)", [org, member])),
    ).rejects.toThrow(/not confirmed/);
    await db.query("update auth.users set encrypted_password='reset-provider-hash' where id=$1", [
      member,
    ]);
    await as(owner, () => db.query("select public.finalize_member_reset($1,$2)", [org, member]));
    await expect(
      as(member, () => db.query("select public.complete_member_setup($1)", [org])),
    ).rejects.toThrow(/Verified password setup/);
    await db.query(
      "update auth.users set encrypted_password='new-personal-provider-hash' where id=$1",
      [member],
    );
    await as(member, () => db.query("select public.complete_member_setup($1)", [org]));
  });
  it("revokes existing JWT access without deleting identity or historical memberships", async () => {
    await db.query(
      "insert into public.notifications(organization_id,user_id,title,body)values($1,$2,'Retained history','Fictional historical notification')",
      [org, member],
    );
    await as(owner, () => db.query("select public.remove_workspace_member($1,$2)", [org, member]));
    expect((await as(member, () => db.query("select id from public.organizations"))).rows).toEqual(
      [],
    );
    expect(
      (
        await db.query(
          "select lifecycle from public.memberships where organization_id=$1 and user_id=$2",
          [org, member],
        )
      ).rows,
    ).toEqual([{ lifecycle: "revoked" }]);
    expect((await db.query("select id from auth.users where id=$1", [member])).rows).toHaveLength(
      1,
    );
    expect(
      (await db.query("select id from public.notifications where user_id=$1", [member])).rows,
    ).toHaveLength(1);
    expect(
      (await as(member, () => db.query("select id from public.notifications"))).rows,
    ).toHaveLength(0);
    await expect(
      as(owner, () => db.query("select public.begin_member_reset($1,$2)", [org, other])),
    ).rejects.toThrow(/cannot be reset/);
    const a = operation();
    await reserve(a); // removed seat can be replaced
  });
  it("enforces a bounded organization management rate limit", async () => {
    for (let index = 0; index < 10; index++) {
      const id = operation();
      await as(other, () =>
        db.query("select public.reserve_member($1,$2,$3,'Fictional member')", [
          otherOrg,
          id,
          `${id}@example.test`,
        ]),
      );
      await as(other, () =>
        db.query("select public.fail_member_reservation($1,$2)", [otherOrg, id]),
      );
    }
    await expect(
      as(other, () =>
        db.query("select public.reserve_member($1,$2,'limited@example.test','Limited member')", [
          otherOrg,
          operation(),
        ]),
      ),
    ).rejects.toThrow(/rate limit/);
  });
});
