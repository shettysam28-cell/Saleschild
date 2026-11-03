import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
const db = new PGlite();
const users = {
  a: "00000000-0000-4000-8000-000000000001",
  b: "00000000-0000-4000-8000-000000000002",
  learner: "00000000-0000-4000-8000-000000000003",
  editor: "00000000-0000-4000-8000-000000000004",
  other: "00000000-0000-4000-8000-000000000005",
  unconfirmed: "00000000-0000-4000-8000-000000000006",
};
let orgA: string, orgB: string, knowledgeA: string, courseB: string, assessmentA: string;
async function asUser<T>(id: string, run: () => Promise<T>): Promise<T> {
  await db.exec("begin; set local role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  try {
    const result = await run();
    await db.exec("commit");
    return result;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
async function asAnon<T>(run: () => Promise<T>) {
  await db.exec("begin; set local role anon;");
  try {
    const result = await run();
    await db.exec("commit");
    return result;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
beforeAll(async () => {
  await db.exec(
    `create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users(id uuid primary key,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null); alter table storage.objects enable row level security; grant usage on schema storage to authenticated,anon; grant select,insert,update,delete on storage.objects to authenticated,anon;`,
  );
  const migration = (await readdir("supabase/migrations")).find((f) =>
    f.endsWith("_phase_0_foundation.sql"),
  );
  expect(migration).toBeTruthy();
  await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
  for (const [label, id] of Object.entries(users))
    await db.query("insert into auth.users(id,email_confirmed_at) values($1,$2)", [
      id,
      label === "unconfirmed" ? null : "2026-11-03T00:00:00Z",
    ]);
  orgA = await asUser(
    users.a,
    async () =>
      (await db.query<{ id: string }>("select public.create_organization('Organization A') as id"))
        .rows[0].id,
  );
  orgB = await asUser(
    users.b,
    async () =>
      (await db.query<{ id: string }>("select public.create_organization('Organization B') as id"))
        .rows[0].id,
  );
  for (const [key, role] of [
    ["learner", "learner"],
    ["editor", "editor"],
    ["other", "learner"],
  ] as const)
    await db.query("insert into public.memberships(organization_id,user_id,role)values($1,$2,$3)", [
      orgA,
      users[key],
      role,
    ]);
  knowledgeA = await asUser(
    users.a,
    async () =>
      (
        await db.query<{ id: string }>(
          "insert into public.knowledge_items(organization_id,title,body,status,created_by)values($1,'Published guide','A useful approved knowledge resource for employees.','published',$2)returning id",
          [orgA, users.a],
        )
      ).rows[0].id,
  );
  await asUser(users.a, () =>
    db.query(
      "insert into public.knowledge_items(organization_id,title,body,status,created_by)values($1,'Private draft','Draft content that learners must not be allowed to read.','draft',$2)",
      [orgA, users.a],
    ),
  );
  await asUser(users.b, () =>
    db.query(
      "insert into public.knowledge_items(organization_id,title,body,status,created_by)values($1,'Other organization','This content belongs to an entirely different organization.','published',$2)",
      [orgB, users.b],
    ),
  );
  courseB = (
    await db.query<{ id: string }>(
      "insert into public.courses(organization_id,title,description,status,created_by)values($1,'Other course','Other organization course description','published',$2)returning id",
      [orgB, users.b],
    )
  ).rows[0].id;
  assessmentA = (
    await db.query<{ id: string }>(
      "insert into public.assessments(organization_id,title,description,status,created_by)values($1,'Historical assessment','Published version','published',$2)returning id",
      [orgA, users.a],
    )
  ).rows[0].id;
});
afterAll(async () => {
  await db.close();
});
describe("actual Phase 0 migration: organization and role isolation", () => {
  it("enables RLS on every public table", async () => {
    const { rows } = await db.query<{ name: string; rls: boolean }>(
      "select relname as name,relrowsecurity as rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'",
    );
    expect(rows.length).toBe(12);
    expect(rows.every((r) => r.rls)).toBe(true);
  });
  it("atomically creates an owner and welcome notification", async () => {
    await asUser(users.a, async () => {
      expect((await db.query("select role from public.memberships")).rows).toEqual(
        expect.arrayContaining([{ role: "owner" }]),
      );
      expect((await db.query("select title from public.notifications")).rows).toHaveLength(1);
    });
  });
  it("denies unconfirmed organization bootstrap", async () => {
    await expect(
      asUser(users.unconfirmed, () =>
        db.query("select public.create_organization('Unverified company')"),
      ),
    ).rejects.toThrow(/Verified identity/);
  });
  it("prevents duplicate self-service organization creation", async () => {
    await expect(
      asUser(users.a, () => db.query("select public.create_organization('Duplicate company')")),
    ).rejects.toThrow(/already exists/);
  });
  it("denies anonymous organization reads", async () => {
    await expect(asAnon(() => db.query("select * from public.organizations"))).rejects.toThrow(
      /permission denied/,
    );
  });
  it("denies anonymous bootstrap execution", async () => {
    await expect(
      asAnon(() => db.query("select public.create_organization('Forged company')")),
    ).rejects.toThrow(/permission denied/);
  });
  it("exposes only the member’s organization", async () => {
    const result = await asUser(users.a, () =>
      db.query<{ id: string }>("select id from public.organizations"),
    );
    expect(result.rows).toEqual([{ id: orgA }]);
  });
  it("cannot self-promote a learner to owner", async () => {
    await expect(
      asUser(users.learner, () =>
        db.query("update public.memberships set role='owner' where user_id=$1", [users.learner]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("cannot insert a forged organization membership", async () => {
    await expect(
      asUser(users.learner, () =>
        db.query("insert into public.memberships values($1,$2,'owner',now())", [
          orgB,
          users.learner,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("does not expose other member identities to learners", async () => {
    const result = await asUser(users.learner, () =>
      db.query<{ user_id: string }>("select user_id from public.memberships"),
    );
    expect(result.rows).toEqual([{ user_id: users.learner }]);
  });
  it("learners see published same-organization resources only", async () => {
    const result = await asUser(users.learner, () =>
      db.query<{ id: string }>("select id from public.knowledge_items"),
    );
    expect(result.rows).toEqual([{ id: knowledgeA }]);
  });
  it("an owner cannot read another organization’s knowledge", async () => {
    const result = await asUser(users.b, () =>
      db.query("select * from public.knowledge_items where id=$1", [knowledgeA]),
    );
    expect(result.rows).toHaveLength(0);
  });
  it("rejects learner knowledge creation", async () => {
    await expect(
      asUser(users.learner, () =>
        db.query(
          "insert into public.knowledge_items(organization_id,title,body,status,created_by)values($1,'Forged guide','A learner cannot author this knowledge record.','published',$2)",
          [orgA, users.learner],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it("rejects cross-tenant author writes", async () => {
    await expect(
      asUser(users.a, () =>
        db.query(
          "insert into public.knowledge_items(organization_id,title,body,status,created_by)values($1,'Forged guide','An owner cannot write into another organization.','published',$2)",
          [orgB, users.a],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it("rejects author identity spoofing", async () => {
    await expect(
      asUser(users.editor, () =>
        db.query(
          "insert into public.knowledge_items(organization_id,title,body,status,created_by)values($1,'Spoofed author','This resource tries to impersonate another author.','draft',$2)",
          [orgA, users.a],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it("learner updates cannot change published content", async () => {
    const result = await asUser(users.learner, () =>
      db.query(
        "update public.knowledge_items set title='Learner modified' where id=$1 returning id",
        [knowledgeA],
      ),
    );
    expect(result.rows).toHaveLength(0);
  });
  it("prevents moving knowledge between organizations", async () => {
    await expect(
      asUser(users.a, () =>
        db.query("update public.knowledge_items set organization_id=$1 where id=$2", [
          orgB,
          knowledgeA,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("creates immutable knowledge snapshots on edits", async () => {
    await asUser(users.editor, () =>
      db.query("update public.knowledge_items set title='Updated approved guide' where id=$1", [
        knowledgeA,
      ]),
    );
    const result = await asUser(users.a, () =>
      db.query<{ version: number; title: string }>(
        "select version,title from public.knowledge_versions where knowledge_id=$1 order by version",
        [knowledgeA],
      ),
    );
    expect(result.rows).toEqual([
      { version: 1, title: "Published guide" },
      { version: 2, title: "Updated approved guide" },
    ]);
    await expect(
      asUser(users.a, () =>
        db.query("update public.knowledge_versions set title='Tampered history'"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("does not let authors self-certify evidence", async () => {
    await expect(
      asUser(users.a, () =>
        db.query("update public.knowledge_items set evidence_status='Verified' where id=$1", [
          knowledgeA,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("rejects a cross-organization course relationship", async () => {
    await expect(
      asUser(users.a, () =>
        db.query(
          "insert into public.lessons(organization_id,course_id,title,body,position)values($1,$2,'Cross tenant lesson','Lesson body',0)",
          [orgA, courseB],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });
  it("preserves published assessment versions", async () => {
    await expect(
      asUser(users.a, () =>
        db.query("update public.assessments set title='Rewritten history' where id=$1", [
          assessmentA,
        ]),
      ),
    ).rejects.toThrow(/immutable/);
  });
  it("does not allow customers to fabricate graded attempts", async () => {
    await expect(
      asUser(users.learner, () =>
        db.query(
          "insert into public.assessment_attempts(organization_id,assessment_id,user_id)values($1,$2,$3)",
          [orgA, assessmentA, users.learner],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("cannot start an autonomous workflow", async () => {
    await expect(
      asUser(users.a, () =>
        db.query(
          "insert into public.ai_workflows(organization_id,requested_by,objective,mode,status)values($1,$2,'Publish all knowledge automatically','autonomous','draft')",
          [orgA, users.a],
        ),
      ),
    ).rejects.toThrow();
  });
  it("protects notifications belonging to another member", async () => {
    const result = await asUser(users.learner, () =>
      db.query("select * from public.notifications"),
    );
    expect(result.rows).toHaveLength(0);
    const update = await asUser(users.learner, () =>
      db.query("update public.notifications set read_at=now() returning id"),
    );
    expect(update.rows).toHaveLength(0);
  });
  it("notification updates cannot rewrite content or recipient", async () => {
    await expect(
      asUser(users.a, () =>
        db.query("update public.notifications set user_id=$1", [users.learner]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(users.a, () => db.query("update public.notifications set body='Injected content'")),
    ).rejects.toThrow(/permission denied/);
  });
  it("keeps governance logs admin-only and non-writable", async () => {
    const result = await asUser(users.learner, () => db.query("select * from public.audit_events"));
    expect(result.rows).toHaveLength(0);
    const owner = await asUser(users.a, () =>
      db.query<{ organization_id: string }>("select organization_id from public.audit_events"),
    );
    expect(owner.rows.length).toBeGreaterThan(0);
    expect(owner.rows.every((r) => r.organization_id === orgA)).toBe(true);
    await expect(
      asUser(users.a, () => db.query("delete from public.audit_events")),
    ).rejects.toThrow(/permission denied/);
  });
  it("records authorized organization changes", async () => {
    await asUser(users.a, () =>
      db.query("update public.organizations set name='Renamed organization' where id=$1", [orgA]),
    );
    const result = await asUser(users.a, () =>
      db.query(
        "select id from public.audit_events where event_type='update' and entity_type='organizations'",
      ),
    );
    expect(result.rows).toHaveLength(1);
  });
  it("stores raw files in a private bucket", async () => {
    const result = await db.query<{ public: boolean; file_size_limit: number }>(
      "select public,file_size_limit from storage.buckets",
    );
    expect(result.rows[0].public).toBe(false);
    expect(Number(result.rows[0].file_size_limit)).toBe(10485760);
  });
  it("isolates uploaded files from other organizations", async () => {
    await asUser(users.a, () =>
      db.query("insert into storage.objects(bucket_id,name)values('organization-knowledge',$1)", [
        `${orgA}/guide.pdf`,
      ]),
    );
    expect(
      (await asUser(users.b, () => db.query("select * from storage.objects"))).rows,
    ).toHaveLength(0);
    await expect(
      asUser(users.b, () =>
        db.query("insert into storage.objects(bucket_id,name)values('organization-knowledge',$1)", [
          `${orgA}/intrusion.pdf`,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it("does not permit moving a file into another tenant", async () => {
    await expect(
      asUser(users.a, () => db.query("update storage.objects set name=$1", [`${orgB}/moved.pdf`])),
    ).rejects.toThrow(/row-level security/);
  });
  it("keeps raw draft sources unavailable to learners", async () => {
    expect(
      (await asUser(users.learner, () => db.query("select * from storage.objects"))).rows,
    ).toHaveLength(0);
  });
  it("rejects traversal-like storage object names", async () => {
    await expect(
      asUser(users.a, () =>
        db.query("insert into storage.objects(bucket_id,name)values('organization-knowledge',$1)", [
          `${orgA}/../other.pdf`,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it("rejects invalid organization prefixes and learner uploads", async () => {
    await expect(
      asUser(users.a, () =>
        db.query(
          "insert into storage.objects(bucket_id,name)values('organization-knowledge','invalid-prefix/file.pdf')",
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(users.learner, () =>
        db.query("insert into storage.objects(bucket_id,name)values('organization-knowledge',$1)", [
          `${orgA}/learner.pdf`,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
