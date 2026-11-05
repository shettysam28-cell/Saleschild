import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const db = new PGlite();
const owner = "10000000-0000-4000-8000-000000000001";
const member = "10000000-0000-4000-8000-000000000002";
const second = "10000000-0000-4000-8000-000000000003";
const foreignOwner = "10000000-0000-4000-8000-000000000004";
const editor = "10000000-0000-4000-8000-000000000005";
let org: string, foreignOrg: string;
async function as<T>(user: string | null, run: () => Promise<T>): Promise<T> {
  await db.exec(`begin;set local role ${user ? "authenticated" : "anon"}`);
  if (user) await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
  try {
    const result = await run();
    await db.exec("commit");
    return result;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
async function scalar<T>(sql: string, args: unknown[] = []) {
  return (await db.query<{ value: T }>(sql, args)).rows[0].value;
}
async function source(
  title = "Product reference",
  fields = [
    { id: "c1", label: "Product", value: randomUUID() },
    { id: "c2", label: "Price", value: "USD 49" },
  ],
) {
  return as(owner, () =>
    scalar<string>(
      "insert into public.knowledge_items(organization_id,title,body,status,custom_fields,created_by)values($1,$2,private.gateway_body($3::jsonb),'published',$3::jsonb,$4)returning id as value",
      [org, title, JSON.stringify(fields), owner],
    ),
  );
}
async function path(sources: string[]) {
  const id = await as(owner, () =>
    scalar<string>(
      "insert into public.courses(organization_id,title,description,created_by)values($1,'Reviewed learning path','Approved source-backed learning composition',$2)returning id as value",
      [org, owner],
    ),
  );
  await as(owner, () =>
    db.query("select public.add_knowledge_to_learning_path($1,$2,$3,$4)", [
      org,
      id,
      sources,
      randomUUID(),
    ]),
  );
  const ids = (
    await db.query<{ id: string }>(
      "select id from public.lessons where course_id=$1 order by position,id",
      [id],
    )
  ).rows.map((r) => r.id);
  return { id, ids };
}
async function publish(id: string, ids: string[]) {
  return as(owner, () =>
    scalar<string>("select public.publish_learning_revision($1,$2,$3) value", [org, id, ids]),
  );
}
async function read(id: string, user = member) {
  return as(user, () =>
    scalar<{
      revision: { id: string; number: number };
      units: { id: string; source_fields: { label: string; value: string }[]; body: string }[];
      progress: Record<string, unknown>[];
    }>("select public.read_learning_revision($1,$2) value", [org, id]),
  );
}
async function record(
  revision: string,
  unit: string,
  action = "start",
  evidence: string | null = null,
  step = 0,
  user = member,
) {
  return as(user, () =>
    scalar<{
      completed_at: string | null;
      started_at: string;
      updated_at: string;
      resume_step: number;
    }>("select public.record_learning_progress($1,$2,$3,$4,$5,$6) value", [
      org,
      revision,
      unit,
      action,
      step,
      evidence,
    ]),
  );
}
beforeAll(async () => {
  await db.exec(
    "create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz,email text,encrypted_password text);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated,anon;",
  );
  for (const f of (await readdir("supabase/migrations")).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  for (const id of [owner, member, second, foreignOwner, editor])
    await db.query("insert into auth.users values($1,now(),$2,'hash')", [id, id + "@example.test"]);
  org = await as(owner, () =>
    scalar<string>("select public.create_organization('Learning organization') value"),
  );
  foreignOrg = await as(foreignOwner, () =>
    scalar<string>("select public.create_organization('Foreign organization') value"),
  );
  for (const [id, role] of [
    [member, "learner"],
    [second, "learner"],
    [editor, "editor"],
  ])
    await db.query("insert into public.memberships(organization_id,user_id,role)values($1,$2,$3)", [
      org,
      id,
      role,
    ]);
});
afterAll(() => db.close());

describe("versioned Learning Path SQL and tenant isolation", () => {
  it("has RLS and no anonymous or customer mutation grants on new progress/snapshot tables", async () => {
    const rows = (
      await db.query<{ relname: string; relrowsecurity: boolean }>(
        "select relname,relrowsecurity from pg_class where relname in('learning_path_revisions','learning_revision_units','learning_unit_progress')",
      )
    ).rows;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    for (const table of rows.map((r) => r.relname)) {
      await expect(as(null, () => db.query(`select * from public.${table}`))).rejects.toThrow(
        /permission denied/,
      );
      expect(
        await scalar<boolean>("select has_table_privilege('authenticated',$1,'INSERT') value", [
          "public." + table,
        ]),
      ).toBe(false);
      expect(
        await scalar<boolean>("select has_table_privilege('authenticated',$1,'UPDATE') value", [
          "public." + table,
        ]),
      ).toBe(false);
    }
  });
  it("has no public SECURITY DEFINER API function", async () => {
    expect(
      (
        await db.query(
          "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef",
        )
      ).rows,
    ).toEqual([]);
  });
  it("publishes ordered approved snapshots idempotently without enrolling a spectator", async () => {
    const p = await path([await source(), await source()]);
    const before = await scalar<number>(
      "select count(*)::int value from public.learning_unit_progress",
    );
    const revision = await publish(p.id, p.ids);
    expect(await publish(p.id, p.ids)).toBe(revision);
    const spectator = await read(p.id, owner);
    expect(spectator.units).toHaveLength(2);
    expect(spectator.progress).toEqual([]);
    expect(
      await scalar<number>("select count(*)::int value from public.learning_unit_progress"),
    ).toBe(before);
    expect(
      await scalar<number>(
        "select count(*)::int value from public.enrollments where course_id=$1",
        [p.id],
      ),
    ).toBe(0);
  });
  it("rejects stale composition and editor/member/foreign publication", async () => {
    const p = await path([await source(), await source()]);
    await expect(publish(p.id, [...p.ids].reverse())).rejects.toThrow(/composition changed/);
    for (const actor of [editor, member, foreignOwner])
      await expect(
        as(actor, () =>
          db.query("select public.publish_learning_revision($1,$2,$3)", [org, p.id, p.ids]),
        ),
      ).rejects.toThrow(/publication requires/);
  });
  it("rejects unlinked legacy lessons instead of fabricating source grounding", async () => {
    const p = await path([await source()]);
    const extra = await as(owner, () =>
      scalar<string>(
        "insert into public.lessons(organization_id,course_id,title,body,position)values($1,$2,'Legacy instruction','No approved provenance',1)returning id value",
        [org, p.id],
      ),
    );
    await expect(publish(p.id, [...p.ids, extra])).rejects.toThrow(/approved source version/);
  });
  it("reading and starting never complete a unit; repeat starts do not churn timestamps", async () => {
    const p = await path([await source()]);
    await publish(p.id, p.ids);
    const data = await read(p.id);
    expect(data.progress).toEqual([]);
    const first = await record(data.revision.id, data.units[0].id);
    expect(first.completed_at).toBeNull();
    const repeat = await record(data.revision.id, data.units[0].id);
    expect(repeat.updated_at).toBe(first.updated_at);
    const moved = await record(data.revision.id, data.units[0].id, "resume", null, 1);
    expect(moved.resume_step).toBe(1);
    expect(moved.completed_at).toBeNull();
    const staleStart = await record(data.revision.id, data.units[0].id);
    expect(staleStart.resume_step).toBe(1);
    expect(staleStart.updated_at).toBe(moved.updated_at);
  });
  it("resumes a previously opened unit at the same step without duplicate timestamp churn", async () => {
    const p = await path([await source(), await source()]);
    await publish(p.id, p.ids);
    const data = await read(p.id);
    await record(data.revision.id, data.units[0].id);
    const b = await record(data.revision.id, data.units[1].id);
    const a = await record(data.revision.id, data.units[0].id, "resume");
    expect(new Date(a.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(b.updated_at).getTime(),
    );
    const again = await record(data.revision.id, data.units[0].id, "resume");
    expect(again.updated_at).toBe(a.updated_at);
  });
  it("matches Unicode field evidence and legacy body fallback without invented answers", async () => {
    const id = await source("Unicode reference", [
      { id: "c1", label: "   内容  ", value: "   安全に進める 😀   " },
      { id: "c2", label: "Reference", value: "Use the approved Unicode source exactly." },
    ]);
    const p = await path([id]);
    await publish(p.id, p.ids);
    const data = await read(p.id);
    await expect(
      record(data.revision.id, data.units[0].id, "complete", "安全に進める 😀"),
    ).resolves.toHaveProperty("completed_at");
    const legacy = await as(owner, () =>
      scalar<string>(
        "insert into public.knowledge_items(organization_id,title,body,status,created_by)values($1,'Legacy approved reference','A full approved source body without structured fields.','published',$2)returning id value",
        [org, owner],
      ),
    );
    const q = await path([legacy]);
    await publish(q.id, q.ids);
    const fallback = await read(q.id);
    await expect(
      record(fallback.revision.id, fallback.units[0].id, "complete", fallback.units[0].body),
    ).resolves.toHaveProperty("completed_at");
  });
  it("requires exact approved evidence and preserves completion across retries", async () => {
    const p = await path([await source()]);
    await publish(p.id, p.ids);
    const data = await read(p.id),
      unit = data.units[0];
    await expect(
      record(data.revision.id, unit.id, "complete", "An invented answer", 1),
    ).rejects.toThrow(/exact documented evidence/);
    expect((await read(p.id)).progress).toEqual([]);
    const done = await record(
      data.revision.id,
      unit.id,
      "complete",
      unit.source_fields[0].value,
      1,
    );
    expect(done.completed_at).toBeTruthy();
    const again = await record(
      data.revision.id,
      unit.id,
      "complete",
      unit.source_fields[0].value,
      1,
    );
    expect(again.completed_at).toBe(done.completed_at);
    expect(again.updated_at).toBe(done.updated_at);
    await record(data.revision.id, unit.id, "resume", null, 0);
    expect((await read(p.id)).progress[0].completed_at).toBe(done.completed_at);
  });
  it("never accepts owner preview writes or cross-tenant/forged unit IDs", async () => {
    const p = await path([await source()]);
    await publish(p.id, p.ids);
    const data = await read(p.id);
    await expect(
      record(data.revision.id, data.units[0].id, "start", null, 0, owner),
    ).rejects.toThrow(/Only active members/);
    await expect(record(data.revision.id, randomUUID())).rejects.toThrow(/Unit does not belong/);
    await expect(
      as(foreignOwner, () => db.query("select public.read_learning_revision($1,$2)", [org, p.id])),
    ).rejects.toThrow(/Organization access/);
    expect(
      (await as(foreignOwner, () => db.query("select * from public.learning_revision_units"))).rows,
    ).toEqual([]);
  });
  it("progress is per member and unauthorized members cannot query another learner", async () => {
    const p = await path([await source()]);
    await publish(p.id, p.ids);
    const data = await read(p.id);
    await record(data.revision.id, data.units[0].id);
    expect((await read(p.id, second)).progress).toEqual([]);
    await expect(
      as(second, () =>
        db.query("select * from public.read_learning_progress($1,$2)", [org, member]),
      ),
    ).rejects.toThrow(/only their own/);
    await expect(
      as(editor, () => db.query("select * from public.read_learning_progress($1)", [org])),
    ).rejects.toThrow(/Owner analytics/);
  });
  it("reports full denominators and unequal path totals without averaging percentages", async () => {
    const p1 = await path([await source()]),
      p2 = await path([await source(), await source(), await source()]);
    await publish(p1.id, p1.ids);
    await publish(p2.id, p2.ids);
    const data = await read(p1.id);
    await record(
      data.revision.id,
      data.units[0].id,
      "complete",
      data.units[0].source_fields[0].value,
      1,
    );
    const rows = (
      await as(owner, () =>
        db.query<{ course_id: string; total_units: number; completed_units: number }>(
          "select * from public.read_learning_progress($1,$2)",
          [org, member],
        ),
      )
    ).rows.filter((r) => [p1.id, p2.id].includes(r.course_id));
    expect(rows.map((r) => Number(r.total_units)).sort()).toEqual([1, 3]);
    expect(
      rows.reduce((sum, r) => sum + Number(r.completed_units), 0) /
        rows.reduce((sum, r) => sum + Number(r.total_units), 0),
    ).toBe(0.25);
    const future = (
      await as(owner, () =>
        db.query<{ completed_units: number }>(
          "select * from public.read_learning_progress($1,$2,$3,$4,$5)",
          [org, member, p1.id, "2090-01-01", "2090-01-02"],
        ),
      )
    ).rows;
    expect(Number(future[0].completed_units)).toBe(0);
    await expect(
      as(owner, () =>
        db.query("select * from public.read_learning_progress($1,null,null,$2,$3)", [
          org,
          "2026-12-02",
          "2026-01-01",
        ]),
      ),
    ).rejects.toThrow(/ordered date/);
    await expect(
      as(owner, () =>
        db.query("select * from public.read_learning_progress($1,null,$2)", [org, randomUUID()]),
      ),
    ).rejects.toThrow(/Path not available/);
  });
  it("preserves earlier snapshots/progress when a draft composition is reopened and republished", async () => {
    const firstSource = await source(),
      p = await path([firstSource]);
    const firstRevision = await publish(p.id, p.ids),
      data = await read(p.id);
    await record(
      firstRevision,
      data.units[0].id,
      "complete",
      data.units[0].source_fields[0].value,
      1,
    );
    await as(owner, () => db.query("select public.begin_learning_revision($1,$2)", [org, p.id]));
    const next = await source();
    await as(owner, () =>
      db.query("select public.add_knowledge_to_learning_path($1,$2,$3,$4)", [
        org,
        p.id,
        [next],
        randomUUID(),
      ]),
    );
    const draftMember = await as(member, () =>
      scalar<{ lessons: unknown[] }>("select public.read_learning_path($1,$2) value", [org, p.id]),
    );
    expect(draftMember.lessons).toHaveLength(1);
    expect(
      (await as(member, () => db.query("select * from public.lessons where course_id=$1", [p.id])))
        .rows,
    ).toEqual([]);
    const ids = (
      await db.query<{ id: string }>(
        "select id from public.lessons where course_id=$1 order by position,id",
        [p.id],
      )
    ).rows.map((r) => r.id);
    const nextRevision = await publish(p.id, ids);
    expect(nextRevision).not.toBe(firstRevision);
    expect((await read(p.id)).revision.number).toBe(2);
    expect((await read(p.id)).progress).toEqual([]);
    expect(
      await scalar<number>(
        "select count(*)::int value from public.learning_unit_progress where revision_id=$1",
        [firstRevision],
      ),
    ).toBe(1);
    await expect(record(firstRevision, data.units[0].id)).rejects.toThrow(
      /newer published revision/,
    );
    await expect(
      db.query("update public.learning_revision_units set title='Changed' where revision_id=$1", [
        firstRevision,
      ]),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.query("delete from public.learning_path_revisions where id=$1", [firstRevision]),
    ).rejects.toThrow(/immutable/);
  });
  it("retains source snapshot when current knowledge becomes a newer draft", async () => {
    const id = await source(),
      p = await path([id]);
    await publish(p.id, p.ids);
    const before = await read(p.id);
    await as(owner, () =>
      db.query("update public.knowledge_items set status='draft' where id=$1", [id]),
    );
    expect((await read(p.id)).units).toEqual(before.units);
  });
  it("Fetch searches only approved same-tenant knowledge, with literal wildcard input", async () => {
    const id = await source("Exact%_ product finder");
    await expect(
      as(owner, () =>
        db.query("select * from public.search_approved_knowledge($1,$2,5)", [
          foreignOrg,
          "product",
        ]),
      ),
    ).rejects.toThrow(/Organization access/);
    const found = (
      await as(member, () =>
        db.query<{ id: string }>("select * from public.search_approved_knowledge($1,$2,5)", [
          org,
          "Exact%_",
        ]),
      )
    ).rows;
    expect(found.map((r) => r.id)).toEqual([id]);
    expect(
      (
        await as(member, () =>
          db.query("select * from public.search_approved_knowledge($1,$2,5)", [
            org,
            "missing impossible",
          ]),
        )
      ).rows,
    ).toEqual([]);
    await as(owner, () =>
      db.query("update public.knowledge_items set status='draft' where id=$1", [id]),
    );
    expect(
      (
        await as(member, () =>
          db.query("select * from public.search_approved_knowledge($1,$2,5)", [org, "Exact%_"]),
        )
      ).rows,
    ).toEqual([]);
    await expect(
      as(foreignOwner, () =>
        db.query("select * from public.search_approved_knowledge($1,$2,5)", [org, "product"]),
      ),
    ).rejects.toThrow(/Organization access/);
    await expect(
      as(member, () =>
        db.query("select * from public.search_approved_knowledge($1,$2,11)", [org, "product"]),
      ),
    ).rejects.toThrow(/at most ten/);
  });
  it("revoked current membership denies progress despite an otherwise valid old JWT", async () => {
    const p = await path([await source()]);
    await publish(p.id, p.ids);
    const data = await read(p.id, second);
    await db.query(
      "update public.memberships set lifecycle='revoked',revoked_at=now() where organization_id=$1 and user_id=$2",
      [org, second],
    );
    await expect(
      record(data.revision.id, data.units[0].id, "start", null, 0, second),
    ).rejects.toThrow(/Only active members/);
    expect(
      (await as(second, () => db.query("select * from public.learning_unit_progress"))).rows,
    ).toEqual([]);
    await db.query(
      "update public.memberships set lifecycle='active',revoked_at=null where organization_id=$1 and user_id=$2",
      [org, second],
    );
  });
  it("unfinished workflow requests cannot be written directly through the database", async () => {
    await expect(
      as(owner, () =>
        db.query(
          "insert into public.ai_workflows(organization_id,requested_by,objective,mode,status)values($1,$2,'A proposed workflow request','manual','draft')",
          [org, owner],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
