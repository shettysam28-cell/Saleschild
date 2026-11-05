import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { sampleRecord } from "@/lib/knowledge/templates";
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
  const migrations = (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  expect(migrations.length).toBeGreaterThan(0);
  for (const migration of migrations)
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
    expect(rows.length).toBe(22);
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
    await asUser(users.a, () =>
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

describe("guided knowledge import migration", () => {
  const request = "10000000-0000-4000-8000-000000000001";
  const record = sampleRecord("product");
  async function importRows(user: string, org: string, records: unknown[], requestId = request) {
    return asUser(user, () =>
      db.query<{ count: number }>(
        "select public.import_knowledge_records($1,$2,'fictional.csv',$3::jsonb) as count",
        [org, requestId, JSON.stringify(records)],
      ),
    );
  }
  it("denies anonymous import and source access", async () => {
    await expect(
      asAnon(() =>
        db.query("select public.import_knowledge_records($1,$2,'x.csv',$3::jsonb)", [
          orgA,
          request,
          JSON.stringify([record]),
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAnon(() => db.query("select * from public.knowledge_source_records")),
    ).rejects.toThrow(/permission denied/);
  });
  it("denies learners, nonmembers and foreign organization authors", async () => {
    for (const id of [users.learner, users.unconfirmed, users.b])
      await expect(importRows(id, orgA, [record])).rejects.toThrow(/Author access/);
  });
  it("atomically imports an editor's source as an unverified draft with version, provenance and audit", async () => {
    expect((await importRows(users.editor, orgA, [record])).rows[0].count).toBe(1);
    const { rows } = await asUser(users.a, () =>
      db.query<{
        status: string;
        evidence_status: string;
        current_version: number;
        fields: unknown;
        source_row: number;
        body: string;
      }>(
        "select k.status,k.evidence_status,k.current_version,k.body,s.fields,s.source_row from public.knowledge_items k join public.knowledge_source_records s on s.knowledge_id=k.id where s.organization_id=$1",
        [orgA],
      ),
    );
    expect(rows[0]).toMatchObject({
      status: "draft",
      evidence_status: "Unverified",
      current_version: 1,
      fields: record,
      source_row: 2,
      body: record["Knowledge Content"],
    });
    expect(rows[0].body).not.toContain(record["Correct Response"]);
    const snapshots = await db.query(
      "select v.id from public.knowledge_versions v join public.knowledge_source_records s on s.knowledge_id=v.knowledge_id",
    );
    expect(snapshots.rows.length).toBe(1);
    expect(
      (
        await db.query(
          "select id from public.audit_events where entity_type='knowledge_import_batches'",
        )
      ).rows.length,
    ).toBe(1);
  });
  it("makes retries idempotent and rejects reusing a request with changed data", async () => {
    expect((await importRows(users.editor, orgA, [record])).rows[0].count).toBe(1);
    await expect(
      importRows(users.editor, orgA, [{ ...record, Topic: "Changed request topic" }]),
    ).rejects.toThrow(/different source/);
    expect((await db.query("select id from public.knowledge_import_batches")).rows.length).toBe(1);
  });
  it("rejects existing duplicates and conflicts without additional records", async () => {
    for (const value of [
      record,
      {
        ...record,
        "Knowledge Content":
          "A conflicting replacement must not overwrite existing organizational knowledge.",
      },
    ])
      await expect(
        importRows(users.a, orgA, [value], "10000000-0000-4000-8000-000000000002"),
      ).rejects.toThrow(/Duplicate or conflicting/);
    expect((await db.query("select id from public.knowledge_source_records")).rows.length).toBe(1);
  });
  it("detects duplicate keys with casing and whitespace variations within one upload", async () => {
    const r = sampleRecord("general");
    await expect(
      importRows(
        users.a,
        orgA,
        [r, { ...r, Topic: ` ${r.Topic.toUpperCase()} ` }],
        "10000000-0000-4000-8000-000000000003",
      ),
    ).rejects.toThrow(/Duplicate or conflicting/);
  });
  it("rolls back the whole batch when any row is invalid and permits a corrected retry", async () => {
    const valid = sampleRecord("technical"),
      invalid = { ...sampleRecord("general"), "Knowledge Content": "short" };
    const id = "10000000-0000-4000-8000-000000000004";
    await expect(importRows(users.a, orgA, [valid, invalid], id)).rejects.toThrow(
      /Invalid knowledge/,
    );
    expect(
      (await db.query("select id from public.knowledge_import_batches where request_id=$1", [id]))
        .rows.length,
    ).toBe(0);
    expect((await importRows(users.a, orgA, [valid], id)).rows[0].count).toBe(1);
  });
  it("rejects oversized counts, missing schema fields, formula cells and impossible dates even through direct RPC", async () => {
    for (const value of [
      [],
      Array.from({ length: 201 }, () => record),
      [{ Topic: "Unknown" }],
      [{ ...record, "Process Steps": "=1+1" }],
      [{ ...record, "Last Reviewed": "2026-02-30" }],
      [{ ...record, Subtopic: "x".repeat(161) }],
    ])
      await expect(
        importRows(users.a, orgA, value, "10000000-0000-4000-8000-000000000005"),
      ).rejects.toThrow();
  });
  it("isolates source snapshots and assessment answers from learners and another organization", async () => {
    for (const id of [users.learner, users.b])
      expect(
        (await asUser(id, () => db.query("select * from public.knowledge_source_records"))).rows,
      ).toEqual([]);
    await expect(
      asUser(users.b, () =>
        db.query("select public.check_knowledge_import($1,$2::jsonb)", [
          orgA,
          JSON.stringify([record]),
        ]),
      ),
    ).rejects.toThrow(/Author access/);
  });
  it("permits the same source in a different organization without sharing identifiers", async () => {
    expect((await importRows(users.b, orgB, [record])).rows[0].count).toBe(1);
    const a = await asUser(users.a, () =>
      db.query<{ knowledge_id: string }>(
        "select knowledge_id from public.knowledge_source_records where fields->>'Topic'=$1",
        [record.Topic],
      ),
    );
    const b = await asUser(users.b, () =>
      db.query<{ knowledge_id: string }>(
        "select knowledge_id from public.knowledge_source_records",
      ),
    );
    expect(a.rows[0].knowledge_id).not.toBe(b.rows[0].knowledge_id);
  });
  it("prevents editors from publishing and allows administrator approval without exposing source answers", async () => {
    const { rows } = await db.query<{ knowledge_id: string }>(
      "select knowledge_id from public.knowledge_source_records where organization_id=$1 and fields->>'Topic'=$2",
      [orgA, record.Topic],
    );
    const id = rows[0].knowledge_id;
    await expect(
      asUser(users.editor, () =>
        db.query("update public.knowledge_items set status='published' where id=$1", [id]),
      ),
    ).rejects.toThrow(/row-level security/);
    await asUser(users.a, () =>
      db.query("update public.knowledge_items set status='published' where id=$1", [id]),
    );
    const visible = await asUser(users.learner, () =>
      db.query<{ title: string }>("select title from public.knowledge_items where id=$1", [id]),
    );
    expect(visible.rows[0].title).toBe(record.Topic);
    expect(
      (
        await asUser(users.learner, () =>
          db.query("select fields from public.knowledge_source_records"),
        )
      ).rows,
    ).toEqual([]);
  });
  it("denies source tampering, deletion and cross-tenant provenance links", async () => {
    await expect(
      asUser(users.a, () => db.query("update public.knowledge_source_records set fields='{}'")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(users.a, () => db.query("delete from public.knowledge_import_batches")),
    ).rejects.toThrow(/permission denied/);
    const source = await db.query<{ batch_id: string; knowledge_id: string }>(
      "select batch_id,knowledge_id from public.knowledge_source_records where organization_id=$1",
      [orgB],
    );
    await expect(
      asUser(users.a, () =>
        db.query(
          "insert into public.knowledge_source_records(organization_id,batch_id,knowledge_id,source_row,fields)values($1,$2,$3,9,$4)",
          [
            orgA,
            source.rows[0].batch_id,
            source.rows[0].knowledge_id,
            JSON.stringify(sampleRecord("onboarding")),
          ],
        ),
      ),
    ).rejects.toThrow();
  });
  it("keeps import RPCs invoker-only and revokes default anonymous function execution", async () => {
    const { rows } = await db.query<{ name: string; definer: boolean; anon: boolean }>(
      "select p.proname as name,p.prosecdef as definer,has_function_privilege('anon',p.oid,'EXECUTE') as anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('check_knowledge_import','import_knowledge_records')",
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.definer && !r.anon)).toBe(true);
  });
});

describe("spreadsheet v2 provenance and duplicate identity", () => {
  const request = "20000000-0000-4000-8000-000000000001";
  const first = {
    ...sampleRecord("general"),
    Topic: "Shared operational topic",
    "Process Steps": "- Inspect the instrument.",
  };
  const second = {
    ...first,
    "Knowledge Content":
      "A separate fictional fact about recording instrument readings before use.",
  };
  const context = { worksheet: "Selected knowledge", rows: [2, 7] };
  const run = (
    id: string,
    org: string,
    records: unknown[],
    nonce = request,
    sourceContext: unknown = context,
  ) =>
    asUser(id, () =>
      db.query<{ count: number }>(
        "select public.import_knowledge_records_v2($1,$2,$3,$4::jsonb,$5::jsonb)count",
        [org, nonce, "official.xlsx", JSON.stringify(records), JSON.stringify(sourceContext)],
      ),
    );
  it("imports independent facts sharing a topic, retains physical source rows and retries idempotently", async () => {
    expect((await run(users.a, orgA, [first, second])).rows[0].count).toBe(2);
    expect((await run(users.a, orgA, [first, second])).rows[0].count).toBe(2);
    const batch = await asUser(users.a, () =>
      db.query<{ source_context: unknown; record_count: number }>(
        "select source_context,record_count from public.knowledge_import_batches where request_id=$1",
        [request],
      ),
    );
    expect(batch.rows[0]).toMatchObject({ source_context: context, record_count: 2 });
  });
  it("rejects exact duplicates and changed retries without partial writes", async () => {
    await expect(
      run(users.a, orgA, [first], "20000000-0000-4000-8000-000000000002", {
        worksheet: "Data",
        rows: [2],
      }),
    ).rejects.toThrow(/Duplicate/);
    await expect(
      run(users.a, orgA, [first, second], request, { worksheet: "Changed sheet", rows: [2, 7] }),
    ).rejects.toThrow(/different source/);
    const before = (
      await db.query<{ count: number }>(
        "select count(*)::int count from public.knowledge_import_batches",
      )
    ).rows[0].count;
    await expect(
      run(
        users.a,
        orgA,
        [
          { ...first, Topic: "New record" },
          { ...second, Topic: "Invalid record", "Knowledge Content": "short" },
        ],
        "20000000-0000-4000-8000-000000000003",
      ),
    ).rejects.toThrow(/Invalid/);
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from public.knowledge_import_batches",
        )
      ).rows[0].count,
    ).toBe(before);
  });
  it("denies foreign tenants and learners, and validates source coordinate payloads", async () => {
    for (const user of [users.b, users.learner])
      await expect(run(user, orgA, [first, second])).rejects.toThrow(/Author access/);
    await expect(
      run(users.a, orgA, [first, second], "20000000-0000-4000-8000-000000000004", {
        worksheet: "Data",
        rows: [2],
      }),
    ).rejects.toThrow(/source context/);
    expect(
      (
        await asUser(users.b, () =>
          db.query("select fields from public.knowledge_source_records where organization_id=$1", [
            orgA,
          ]),
        )
      ).rows,
    ).toEqual([]);
  });
});

describe("Universal Gateway and existing Learning Paths (real migrations and RLS)", () => {
  const fields = [
    { id: "c1", label: "Item", value: "Fictional equipment check" },
    { id: "c2", label: "Team", value: "Operations" },
    {
      id: "c3",
      label: "Local instruction",
      value: "Inspect the fictional safety indicator before starting the training device.",
    },
  ];
  let uploadId: string, knowledgeId: string, otherKnowledgeId: string, pathId: string;
  const request = "30000000-0000-4000-8000-000000000001";
  async function stage(
    values = fields,
    options: { title?: string; confirmed?: boolean; edit?: string; rows?: number } = {},
  ) {
    const name = "fictional-source-" + crypto.randomUUID() + ".csv";
    const extraction = {
      name,
      format: "csv",
      warnings: [],
      sheets: [
        {
          name: "CSV",
          rows: [
            { row: 1, cells: values.map((f) => f.label) },
            ...Array.from({ length: options.rows ?? 1 }, (_, i) => ({
              row: i + 2,
              cells: values.map((f) => (i === 0 ? f.value : f.value + " additional " + i)),
            })),
          ],
        },
      ],
    };
    const choices = { sheet: 0, headerRow: 1, titleColumn: "", labels: [], edits: {} };
    const id = (
      await asUser(users.a, () =>
        db.query<{ id: string }>("select public.stage_gateway_upload($1,$2,$3,'csv',$4,$5) id", [
          orgA,
          name,
          "a".repeat(64),
          JSON.stringify(extraction),
          JSON.stringify(choices),
        ]),
      )
    ).rows[0].id;
    const rows = extraction.sheets[0].rows.slice(1).map((r) => ({
      key: "0:" + r.row,
      row: r.row,
      title: options.title ?? r.cells[0],
      fields: values.map((f, i) => ({
        ...f,
        value: options.edit && i === 2 ? options.edit : r.cells[i],
      })),
      excluded: false,
      confirmed: options.confirmed ?? false,
      errors: [],
      exact: [],
      possible: [],
    }));
    await asUser(users.a, () =>
      db.query("select public.save_gateway_review($1,$2,0,$3,$4)", [
        orgA,
        id,
        JSON.stringify(choices),
        JSON.stringify(rows),
      ]),
    );
    return { id, rows, choices };
  }
  async function commit(id: string, requestId = crypto.randomUUID()) {
    return (
      await asUser(users.a, () =>
        db.query<{ ids: string[] }>("select public.commit_gateway_upload($1,$2,1,$3) ids", [
          orgA,
          id,
          requestId,
        ]),
      )
    ).rows[0].ids;
  }
  it("denies anonymous and learner entry points", async () => {
    await expect(asAnon(() => db.query("select * from public.gateway_uploads"))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asAnon(() => db.query("select public.check_gateway_duplicates($1,'[]')", [orgA])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(users.learner, () =>
        db.query("select public.stage_gateway_upload($1,'fake.csv',$2,'csv','{}','{}')", [
          orgA,
          "a".repeat(64),
        ]),
      ),
    ).rejects.toThrow(/Author access/);
  });
  it("stages extraction privately without creating knowledge", async () => {
    const before = (
      await db.query<{ n: number }>("select count(*)::int n from public.knowledge_items")
    ).rows[0].n;
    const staged = await stage();
    uploadId = staged.id;
    expect(
      (await db.query<{ n: number }>("select count(*)::int n from public.knowledge_items")).rows[0]
        .n,
    ).toBe(before);
    expect(
      (
        await asUser(users.b, () =>
          db.query("select id from public.gateway_uploads where id=$1", [uploadId]),
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(users.editor, () =>
          db.query("select id from public.gateway_uploads where id=$1", [uploadId]),
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("atomically saves custom fields, original provenance and a version snapshot", async () => {
    const ids = await commit(uploadId, request);
    expect(ids).toHaveLength(1);
    knowledgeId = ids[0];
    const record = (
      await asUser(users.a, () =>
        db.query<{ status: string; custom_fields: unknown; body: string; current_version: number }>(
          "select status,custom_fields,body,current_version from public.knowledge_items where id=$1",
          [knowledgeId],
        ),
      )
    ).rows[0];
    expect(record).toMatchObject({ status: "draft", custom_fields: fields, current_version: 1 });
    expect(record.body).toContain("Local instruction: Inspect");
    const source = (
      await asUser(users.a, () =>
        db.query<{ origin: { row: number; headerRow: number }; original_fields: unknown }>(
          "select origin,original_fields from public.gateway_sources where knowledge_id=$1",
          [knowledgeId],
        ),
      )
    ).rows[0];
    expect(source.origin).toMatchObject({ row: 2, headerRow: 1, worksheet: "CSV", format: "csv" });
    expect(source.original_fields).toEqual(fields);
    expect(
      (
        await asUser(users.a, () =>
          db.query<{ custom_fields: unknown }>(
            "select custom_fields from public.knowledge_versions where knowledge_id=$1 and version=1",
            [knowledgeId],
          ),
        )
      ).rows[0].custom_fields,
    ).toEqual(fields);
  });
  it("replays a lost-response save without creating duplicate drafts", async () => {
    expect(await commit(uploadId, request)).toEqual([knowledgeId]);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.gateway_sources where upload_id=$1",
          [uploadId],
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(commit(uploadId)).rejects.toThrow(/already saved/);
  });
  it("rolls back a whole batch containing an exact duplicate", async () => {
    const staged = await stage();
    const newFields = fields.map((f) => ({ ...f, value: f.value + " novel" }));
    const rows = [
      { ...staged.rows[0], row: 3, key: "0:3", title: "A new candidate", fields: newFields },
      staged.rows[0],
    ];
    // A valid second source row is required; malformed provenance also fails atomically.
    const prior = (
      await db.query<{ n: number }>("select count(*)::int n from public.knowledge_items")
    ).rows[0].n;
    await asUser(users.a, () =>
      db.query("select public.save_gateway_review($1,$2,1,$3,$4)", [
        orgA,
        staged.id,
        JSON.stringify(staged.choices),
        JSON.stringify([staged.rows[0], ...rows]),
      ]),
    );
    await expect(
      asUser(users.a, () =>
        db.query("select public.commit_gateway_upload($1,$2,2,$3)", [
          orgA,
          staged.id,
          crypto.randomUUID(),
        ]),
      ),
    ).rejects.toThrow();
    expect(
      (await db.query<{ n: number }>("select count(*)::int n from public.knowledge_items")).rows[0]
        .n,
    ).toBe(prior);
    await asUser(users.a, () =>
      db.query("delete from public.gateway_uploads where id=$1", [staged.id]),
    );
  });
  it("checks exact duplicates using the full field set, independently of column ordering", async () => {
    const found = (
      await asUser(users.a, () =>
        db.query<{ result: { key: string; exact: { id: string }[] }[] }>(
          "select public.check_gateway_duplicates($1,$2)result",
          [
            orgA,
            JSON.stringify([{ key: "new", title: "Any title", fields: [...fields].reverse() }]),
          ],
        ),
      )
    ).rows[0].result;
    expect(found[0].exact[0].id).toBe(knowledgeId);
    const staged = await stage();
    await expect(commit(staged.id)).rejects.toThrow(/Exact duplicate/);
    await asUser(users.a, () =>
      db.query("delete from public.gateway_uploads where id=$1", [staged.id]),
    );
  });
  it("requires review of possible duplicates while allowing distinct facts sharing a title", async () => {
    const different = fields.map((f) =>
      f.id === "c3"
        ? {
            ...f,
            value:
              "A second independently useful fictional instruction describing the shutdown process.",
          }
        : f,
    );
    const staged = await stage(different);
    await expect(commit(staged.id)).rejects.toThrow(/Inspect possible/);
    staged.rows[0].confirmed = true;
    await asUser(users.a, () =>
      db.query("select public.save_gateway_review($1,$2,1,$3,$4)", [
        orgA,
        staged.id,
        JSON.stringify(staged.choices),
        JSON.stringify(staged.rows),
      ]),
    );
    otherKnowledgeId = (
      await asUser(users.a, () =>
        db.query<{ ids: string[] }>("select public.commit_gateway_upload($1,$2,2,$3) ids", [
          orgA,
          staged.id,
          crypto.randomUUID(),
        ]),
      )
    ).rows[0].ids[0];
    expect(otherKnowledgeId).not.toBe(knowledgeId);
  });
  it("rejects cross-tenant saves, review edits and malformed mappings/provenance", async () => {
    await expect(
      asUser(users.b, () =>
        db.query("select public.commit_gateway_upload($1,$2,1,$3)", [orgA, uploadId, request]),
      ),
    ).rejects.toThrow(/Author access/);
    await expect(
      asUser(users.b, () =>
        db.query("select public.save_gateway_review($1,$2,1,'{}','[]')", [orgA, uploadId]),
      ),
    ).rejects.toThrow(/Author access/);
    const staged = await stage(fields, {
      title: "A corrected independent source",
      edit: "A fictional source that has not previously been imported into this organization.",
    });
    staged.rows[0].row = 999;
    await asUser(users.a, () =>
      db.query("select public.save_gateway_review($1,$2,1,$3,$4)", [
        orgA,
        staged.id,
        JSON.stringify(staged.choices),
        JSON.stringify(staged.rows),
      ]),
    );
    await expect(
      asUser(users.a, () =>
        db.query("select public.commit_gateway_upload($1,$2,2,$3)", [
          orgA,
          staged.id,
          crypto.randomUUID(),
        ]),
      ),
    ).rejects.toThrow(/Invalid reviewed record/);
    await asUser(users.a, () =>
      db.query("delete from public.gateway_uploads where id=$1", [staged.id]),
    );
  });
  it("preserves original fields and old versions when live edits create a draft", async () => {
    const revised = fields.map((f) =>
      f.id === "c3"
        ? {
            ...f,
            value:
              "A reviewed fictional instruction with an amended setup step and a second safety check.",
          }
        : f,
    );
    expect(
      (
        await asUser(users.a, () =>
          db.query<{ v: number }>("select public.update_gateway_knowledge($1,$2,1,$3,$4)v", [
            orgA,
            knowledgeId,
            "Fictional setup revised",
            JSON.stringify(revised),
          ]),
        )
      ).rows[0].v,
    ).toBe(2);
    expect(
      (
        await asUser(users.a, () =>
          db.query<{ custom_fields: unknown }>(
            "select custom_fields from public.knowledge_versions where knowledge_id=$1 and version=1",
            [knowledgeId],
          ),
        )
      ).rows[0].custom_fields,
    ).toEqual(fields);
    expect(
      (
        await asUser(users.a, () =>
          db.query<{ original_fields: unknown }>(
            "select original_fields from public.gateway_sources where knowledge_id=$1",
            [knowledgeId],
          ),
        )
      ).rows[0].original_fields,
    ).toEqual(fields);
    await expect(
      asUser(users.a, () =>
        db.query("select public.update_gateway_knowledge($1,$2,1,$3,$4)", [
          orgA,
          knowledgeId,
          "Stale title",
          JSON.stringify(fields),
        ]),
      ),
    ).rejects.toThrow(/Record changed/);
  });
  it("denies editor publication and unapproved learning sources without partial lessons", async () => {
    await expect(
      asUser(users.editor, () =>
        db.query("update public.knowledge_items set status='published' where id=$1", [knowledgeId]),
      ),
    ).rejects.toThrow(/row-level security/);
    pathId = (
      await asUser(users.a, () =>
        db.query<{ id: string }>(
          "insert into public.courses(organization_id,title,description,created_by)values($1,'Existing Learning Path','A fictional path for source-linked learning acceptance.',$2)returning id",
          [orgA, users.a],
        ),
      )
    ).rows[0].id;
    await expect(
      asUser(users.a, () =>
        db.query("select public.add_knowledge_to_learning_path($1,$2,$3,$4)", [
          orgA,
          pathId,
          [knowledgeA, knowledgeId],
          crypto.randomUUID(),
        ]),
      ),
    ).rejects.toThrow(/Every source must be approved/);
    expect(
      (await db.query("select id from public.lessons where course_id=$1", [pathId])).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query("select id from public.learning_path_source_batches where course_id=$1", [
          pathId,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  const pathRequest = "30000000-0000-4000-8000-000000000003";
  it("adds approved sources to an existing path in explicit order with idempotent retry", async () => {
    await asUser(users.a, () =>
      db.query("update public.knowledge_items set status='published' where id=any($1)", [
        [knowledgeId, otherKnowledgeId],
      ]),
    );
    for (let i = 0; i < 2; i++)
      expect(
        (
          await asUser(users.a, () =>
            db.query<{ n: number }>("select public.add_knowledge_to_learning_path($1,$2,$3,$4)n", [
              orgA,
              pathId,
              [otherKnowledgeId, knowledgeId],
              pathRequest,
            ]),
          )
        ).rows[0].n,
      ).toBe(2);
    const lessons = (
      await asUser(users.a, () =>
        db.query<{
          source_knowledge_id: string;
          source_version: number;
          position: number;
          body: string;
        }>(
          "select source_knowledge_id,source_version,position,body from public.lessons where course_id=$1 order by position",
          [pathId],
        ),
      )
    ).rows;
    expect(lessons.map((l) => l.source_knowledge_id)).toEqual([otherKnowledgeId, knowledgeId]);
    expect(lessons.map((l) => l.position)).toEqual([0, 1]);
    expect(lessons[1].source_version).toBe(3);
    expect(lessons[1].body).toContain("Local instruction:");
  });
  it("reopens persisted path content and custom fields after later source edits", async () => {
    const changed = fields.map((f) => ({ ...f, value: f.value + " subsequently changed" }));
    await asUser(users.a, () =>
      db.query("select public.update_gateway_knowledge($1,$2,3,'New draft revision',$3)", [
        orgA,
        knowledgeId,
        JSON.stringify(changed),
      ]),
    );
    const data = (
      await asUser(users.a, () =>
        db.query<{
          result: { lessons: { source_version: number; source_fields: unknown; body: string }[] };
        }>("select public.read_learning_path($1,$2) result", [orgA, pathId]),
      )
    ).rows[0].result;
    expect(data.lessons).toHaveLength(2);
    expect(data.lessons[1].source_version).toBe(3);
    expect(data.lessons[1].body).toContain("amended setup step");
    expect(data.lessons[1].body).not.toContain("subsequently changed");
    expect(data.lessons[1].source_fields).not.toEqual(changed);
  });
  it("enforces path and source tenant isolation for reads and writes", async () => {
    await expect(
      asUser(users.b, () => db.query("select public.read_learning_path($1,$2)", [orgA, pathId])),
    ).rejects.toThrow(/Organization access/);
    expect(
      (
        await asUser(users.b, () =>
          db.query("select id from public.lessons where course_id=$1", [pathId]),
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      asUser(users.b, () =>
        db.query("select public.add_knowledge_to_learning_path($1,$2,$3,$4)", [
          orgB,
          pathId,
          [knowledgeA],
          crypto.randomUUID(),
        ]),
      ),
    ).rejects.toThrow(/Learning path not found/);
    expect(
      (
        await asUser(users.b, () =>
          db.query("select id from public.gateway_sources where knowledge_id=$1", [knowledgeId]),
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      asUser(users.learner, () =>
        db.query("select public.add_knowledge_to_learning_path($1,$2,$3,$4)", [
          orgA,
          pathId,
          [knowledgeA],
          crypto.randomUUID(),
        ]),
      ),
    ).rejects.toThrow(/Author access/);
  });
  it("keeps source and historical field snapshots immutable", async () => {
    await expect(
      asUser(users.a, () =>
        db.query("update public.gateway_sources set original_fields='[]' where knowledge_id=$1", [
          knowledgeId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(users.a, () =>
        db.query("update public.knowledge_versions set custom_fields='[]' where knowledge_id=$1", [
          knowledgeId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("rejects direct edits that forge an approved lesson snapshot", async () => {
    await expect(
      asUser(users.a, () =>
        db.query(
          "update public.lessons set body='An unreviewed replacement for approved source content.' where course_id=$1",
          [pathId],
        ),
      ),
    ).rejects.toThrow(/Lessons must match an approved source version/);
    expect(
      (await db.query("select id from public.lessons where course_id=$1", [pathId])).rows,
    ).toHaveLength(2);
  });
  it("rejects direct lesson insertion referencing an unapproved source version", async () => {
    const current = (
      await asUser(users.a, () =>
        db.query<{ title: string; body: string; current_version: number }>(
          "select title,body,current_version from public.knowledge_items where id=$1",
          [knowledgeId],
        ),
      )
    ).rows[0];
    await expect(
      asUser(users.a, () =>
        db.query(
          "insert into public.lessons(organization_id,course_id,title,body,position,source_knowledge_id,source_version)values($1,$2,$3,$4,99,$5,$6)",
          [orgA, pathId, current.title, current.body, knowledgeId, current.current_version],
        ),
      ),
    ).rejects.toThrow(/Lessons must match an approved source version/);
  });
  it("keeps every new public RPC invoker-only and unavailable to anonymous callers", async () => {
    const names = [
      "stage_gateway_upload",
      "check_gateway_duplicates",
      "save_gateway_review",
      "commit_gateway_upload",
      "update_gateway_knowledge",
      "add_knowledge_to_learning_path",
      "read_learning_path",
    ];
    const functions = (
      await db.query<{ prosecdef: boolean; anonymous: boolean }>(
        "select prosecdef,has_function_privilege('anon',p.oid,'execute') anonymous from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname=any($1)",
        [names],
      )
    ).rows;
    expect(functions).toHaveLength(names.length);
    expect(functions.every((f) => !f.prosecdef && !f.anonymous)).toBe(true);
  });
  it("lets editors add approved organization knowledge without granting source update/publication access", async () => {
    const editorPath = (
      await asUser(users.editor, () =>
        db.query<{ id: string }>(
          "insert into public.courses(organization_id,title,description,created_by)values($1,'Editor-authored path','A draft path containing approved source snapshots.',$2)returning id",
          [orgA, users.editor],
        ),
      )
    ).rows[0].id;
    const added = await asUser(users.editor, () =>
      db.query<{ n: number }>("select public.add_knowledge_to_learning_path($1,$2,$3,$4)n", [
        orgA,
        editorPath,
        [otherKnowledgeId],
        crypto.randomUUID(),
      ]),
    );
    expect(added.rows[0].n).toBe(1);
    expect(
      (
        await asUser(users.editor, () =>
          db.query(
            "update public.knowledge_items set title='Unauthorized published edit' where id=$1 returning id",
            [otherKnowledgeId],
          ),
        )
      ).rows,
    ).toHaveLength(0);
  });
});
