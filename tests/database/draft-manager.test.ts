import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { DraftGroup } from "@/lib/knowledge/draft-types";
import { sampleRecord } from "@/lib/knowledge/templates";

const db = new PGlite();
const owner = "20000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";
const member = "20000000-0000-4000-8000-000000000003";
const editor = "20000000-0000-4000-8000-000000000004";
let org: string, foreign: string;
async function as<T>(user: string | null, run: () => Promise<T>): Promise<T> {
  await db.exec(`begin;set local role ${user ? "authenticated" : "anon"}`);
  if (user) await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
  try {
    const result = await run();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
async function scalar<T>(sql: string, args: unknown[] = []) {
  return (await db.query<{ value: T }>(sql, args)).rows[0].value;
}
async function list(user = owner, organization = org) {
  return as(user, () =>
    scalar<DraftGroup[]>("select public.list_knowledge_draft_groups_v2($1) value", [organization]),
  );
}
async function upload(name = "Company handbook.csv", user = owner) {
  return as(user, () =>
    scalar<string>("select public.stage_gateway_upload($1,$2,$3,'csv',$4::jsonb,$5::jsonb) value", [
      org,
      name,
      randomUUID().replaceAll("-", "").repeat(2),
      JSON.stringify({
        sheets: [
          {
            name: "Company",
            rows: [
              { row: 1, cells: ["Product", "Guidance"] },
              { row: 2, cells: [name, "An explicit reference fact for employee learning."] },
            ],
          },
        ],
      }),
      JSON.stringify({
        sheet: 0,
        headerRow: 1,
        titleColumn: "c1",
        labels: ["Product", "Guidance"],
        edits: {},
      }),
    ]),
  );
}
async function save(name = randomUUID(), user = owner) {
  const id = await upload(name + ".csv", user);
  const fields = [
    { id: "c1", label: "Product", value: name },
    { id: "c2", label: "Guidance", value: "An explicit reference fact for employee learning." },
  ];
  await as(user, () =>
    db.query("select public.save_gateway_review($1,$2,0,$3::jsonb,$4::jsonb)", [
      org,
      id,
      JSON.stringify({ sheet: 0, headerRow: 1 }),
      JSON.stringify([
        { row: 2, key: "0:2", title: name, fields, excluded: false, confirmed: false },
      ]),
    ]),
  );
  const ids = await as(user, () =>
    scalar<string[]>("select public.commit_gateway_upload($1,$2,1,$3) value", [
      org,
      id,
      randomUUID(),
    ]),
  );
  return { id, ids, fields, name };
}
async function discard(
  group: DraftGroup,
  user = owner,
  expected = group.records.filter((r) => !r.discarded).map(({ id, version }) => ({ id, version })),
) {
  return as(user, () =>
    scalar<number>("select public.discard_knowledge_draft_group($1,$2,$3,$4::jsonb) value", [
      org,
      group.id,
      group.kind,
      JSON.stringify(expected),
    ]),
  );
}
beforeAll(async () => {
  await db.exec(
    "create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz,email text,encrypted_password text);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated,anon;",
  );
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  for (const id of [owner, other, member, editor])
    await db.query("insert into auth.users values($1,now(),$2,'hash')", [id, id + "@example.test"]);
  org = await as(owner, () =>
    scalar<string>("select public.create_organization('Draft manager organization') value"),
  );
  foreign = await as(other, () =>
    scalar<string>("select public.create_organization('Foreign draft organization') value"),
  );
  for (const [user, role] of [
    [member, "learner"],
    [editor, "editor"],
  ])
    await db.query("insert into public.memberships(organization_id,user_id,role)values($1,$2,$3)", [
      org,
      user,
      role,
    ]);
});
afterAll(() => db.close());
describe("grouped drafts: actual migration and RLS", () => {
  it("keeps every migrated table protected and exposes no privileged or anonymous APIs", async () => {
    expect(
      await scalar<number>(
        "select count(*)::int value from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity",
      ),
    ).toBe(0);
    expect(
      await scalar<number>(
        "select count(*)::int value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef",
      ),
    ).toBe(0);
    expect(
      await scalar<number>(
        "select count(*)::int value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and has_function_privilege('anon',p.oid,'execute')",
      ),
    ).toBe(0);
    expect(
      await scalar<number>(
        "select count(*)::int value from information_schema.role_table_grants where table_schema='public' and grantee='anon'",
      ),
    ).toBe(0);
  });
  it("lists only the author's own unfinished reviews without exposing raw extraction", async () => {
    const own = await upload("Private unfinished.csv");
    const someone = await upload("Editor unfinished.csv", editor);
    const groups = await list();
    expect(groups.find((g) => g.id === own)).toMatchObject({
      kind: "review",
      resumable: true,
      discardable: true,
      blockedReason: null,
    });
    expect(groups.some((g) => g.id === someone)).toBe(false);
    expect(JSON.stringify(groups)).not.toContain("extraction");
  });
  it("groups saved records by stable upload IDs and exposes only a summary to fellow authors", async () => {
    const saved = await save();
    const group = (await list(editor)).find((g) => g.id === saved.id)!;
    expect(group.kind).toBe("gateway");
    expect(group.recordCount).toBe(1);
    expect(group.draftCount).toBe(1);
    expect(group.resumable).toBe(false);
    expect(group.discardable).toBe(true);
    expect(group.blockedReason).toBeNull();
    expect(group.records[0]).toMatchObject({
      id: saved.ids[0],
      status: "draft",
      version: 1,
      discarded: false,
    });
  });
  it("keeps individual drafts separate from upload groups and denies learner or foreign access", async () => {
    const grouped = await save();
    const manualId = await as(owner, () =>
      scalar<string>(
        "insert into public.knowledge_items(organization_id,title,body,created_by)values($1,'Individual fictional resource','An authored draft outside spreadsheet uploads.',$2)returning id value",
        [org, owner],
      ),
    );
    const result = await as(owner, () =>
      db.query<{ id: string }>("select * from public.list_individual_knowledge_drafts($1)", [org]),
    );
    expect(result.rows.map((row) => row.id)).toContain(manualId);
    expect(result.rows.map((row) => row.id)).not.toContain(grouped.ids[0]);
    await expect(
      as(member, () =>
        db.query("select * from public.list_individual_knowledge_drafts($1)", [org]),
      ),
    ).rejects.toThrow(/Author access/);
    await expect(
      as(other, () => db.query("select * from public.list_individual_knowledge_drafts($1)", [org])),
    ).rejects.toThrow(/Author access/);
  });
  it("denies anonymous, learners, and other organizations", async () => {
    await expect(
      as(null, () => db.query("select public.list_knowledge_draft_groups($1)", [org])),
    ).rejects.toThrow(/permission denied/);
    await expect(list(member)).rejects.toThrow(/Author access/);
    await expect(list(other, org)).rejects.toThrow(/Author access/);
    expect(await list(other, foreign)).toEqual([]);
  });
  it("soft-discards atomically, retains source/version/audit identities and supports safe retry", async () => {
    const saved = await save();
    const group = (await list()).find((g) => g.id === saved.id)!;
    expect(await discard(group)).toBe(1);
    expect(await discard(group)).toBe(0);
    const result = await db.query<{ discarded_at: string; current_version: number }>(
      "select discarded_at,current_version from public.knowledge_items where id=$1",
      [saved.ids[0]],
    );
    expect(result.rows[0].discarded_at).toBeTruthy();
    expect(result.rows[0].current_version).toBe(2);
    expect(
      await scalar<number>(
        "select count(*)::int value from public.knowledge_versions where knowledge_id=$1",
        [saved.ids[0]],
      ),
    ).toBe(2);
    expect(
      await scalar<number>(
        "select count(*)::int value from public.gateway_sources where knowledge_id=$1",
        [saved.ids[0]],
      ),
    ).toBe(1);
    expect(
      await scalar<number>(
        "select count(*)::int value from public.audit_events where entity_id=$1",
        [saved.ids[0]],
      ),
    ).toBeGreaterThanOrEqual(2);
    expect((await list()).find((g) => g.id === saved.id)).toMatchObject({
      draftCount: 0,
      discardedCount: 1,
    });
  });
  it("allows a new upload of discarded content while retaining the original provenance", async () => {
    const saved = await save();
    await discard((await list()).find((g) => g.id === saved.id)!);
    const checks = await as(owner, () =>
      scalar<{ exact: unknown[]; possible: unknown[] }[]>(
        "select public.check_gateway_duplicates($1,$2::jsonb) value",
        [org, JSON.stringify([{ key: "0:2", title: saved.name, fields: saved.fields }])],
      ),
    );
    expect(checks[0].exact).toEqual([]);
    expect(checks[0].possible).toEqual([]);
    const replacement = await save(saved.name);
    expect(replacement.id).not.toBe(saved.id);
    expect(replacement.ids[0]).not.toBe(saved.ids[0]);
  });
  it("prevents editing or publishing discarded drafts and denies direct lifecycle changes", async () => {
    const saved = await save();
    await discard((await list()).find((g) => g.id === saved.id)!);
    await expect(
      as(owner, () =>
        db.query("update public.knowledge_items set status='published' where id=$1", [
          saved.ids[0],
        ]),
      ),
    ).rejects.toThrow(/Discarded drafts are immutable/);
    await expect(
      as(owner, () =>
        db.query("update public.knowledge_items set discarded_at=null where id=$1", [saved.ids[0]]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(owner, () =>
        db.query("insert into public.knowledge_source_records(discarded_at) values(now())"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("rejects stale confirmation with zero partial archive writes", async () => {
    const saved = await save();
    const group = (await list()).find((g) => g.id === saved.id)!;
    await as(owner, () =>
      db.query("update public.knowledge_items set title='Updated draft title' where id=$1", [
        saved.ids[0],
      ]),
    );
    await expect(discard(group)).rejects.toThrow(/Draft versions changed/);
    expect(
      await scalar<string | null>(
        "select discarded_at value from public.knowledge_items where id=$1",
        [saved.ids[0]],
      ),
    ).toBeNull();
  });
  it("rejects published or previously published sources without modifying the group", async () => {
    const saved = await save();
    await as(owner, () =>
      db.query("update public.knowledge_items set status='published' where id=$1", [saved.ids[0]]),
    );
    const protectedGroup = (await list()).find((g) => g.id === saved.id)!;
    expect(protectedGroup.discardable).toBe(false);
    expect(protectedGroup.blockedReason).toMatch(/published|learning-linked/);
    await expect(discard(protectedGroup)).rejects.toThrow(/Approved or dependent/);
    await as(owner, () =>
      db.query("update public.knowledge_items set status='draft' where id=$1", [saved.ids[0]]),
    );
    await expect(discard((await list()).find((g) => g.id === saved.id)!)).rejects.toThrow(
      /Approved or dependent/,
    );
    expect(
      await scalar<string | null>(
        "select discarded_at value from public.knowledge_items where id=$1",
        [saved.ids[0]],
      ),
    ).toBeNull();
  });
  it("denies foreign-group and member discards", async () => {
    const saved = await save();
    const group = (await list()).find((g) => g.id === saved.id)!;
    await expect(discard(group, other)).rejects.toThrow(/Author access/);
    await expect(discard(group, member)).rejects.toThrow(/Author access/);
    expect(
      await scalar<string | null>(
        "select discarded_at value from public.knowledge_items where id=$1",
        [saved.ids[0]],
      ),
    ).toBeNull();
  });
  it("rejects a mixed approved/draft batch atomically and preserves Learning Path dependencies", async () => {
    const saved = await save();
    const secondId = await as(owner, () =>
      scalar<string>(
        "insert into public.knowledge_items(organization_id,title,body,created_by)values($1,'Second draft in same upload','A second record retained when the batch cannot be discarded.',$2)returning id value",
        [org, owner],
      ),
    );
    await as(owner, () =>
      db.query(
        "insert into public.gateway_sources(organization_id,knowledge_id,upload_id,origin,original_fields)values($1,$2,$3,$4::jsonb,$5::jsonb)",
        [
          org,
          secondId,
          saved.id,
          JSON.stringify({ fileName: saved.name + ".csv" }),
          JSON.stringify(saved.fields),
        ],
      ),
    );
    await as(owner, () =>
      db.query("update public.knowledge_items set status='published' where id=$1", [saved.ids[0]]),
    );
    const pathId = await as(owner, () =>
      scalar<string>(
        "insert into public.courses(organization_id,title,description,created_by)values($1,'Preserved source path','A real path with approved source dependencies',$2)returning id value",
        [org, owner],
      ),
    );
    await as(owner, () =>
      db.query("select public.add_knowledge_to_learning_path($1,$2,$3,$4)", [
        org,
        pathId,
        saved.ids,
        randomUUID(),
      ]),
    );
    const group = (await list()).find((g) => g.id === saved.id)!;
    expect(group.draftCount).toBe(1);
    expect(group.publishedCount).toBe(1);
    expect(group.discardable).toBe(false);
    expect(group.blockedReason).toContain("published");
    await expect(discard(group)).rejects.toThrow(/Approved or dependent/);
    expect(
      await scalar<number>(
        "select count(*)::int value from public.knowledge_items where id=any($1) and discarded_at is null",
        [[...saved.ids, secondId]],
      ),
    ).toBe(2);
    expect(
      await scalar<number>("select count(*)::int value from public.lessons where course_id=$1", [
        pathId,
      ]),
    ).toBe(1);
    await as(owner, () =>
      db.query("update public.knowledge_items set status='draft' where id=$1", [saved.ids[0]]),
    );
    await expect(discard((await list()).find((g) => g.id === saved.id)!)).rejects.toThrow(
      /Approved or dependent/,
    );
  });
  it("can discard only the current author's unused review", async () => {
    const id = await upload("Discard unfinished.csv");
    const group = (await list()).find((g) => g.id === id)!;
    await expect(discard(group, editor)).rejects.toThrow(/Review is no longer available/);
    expect(await discard(group)).toBe(1);
    expect((await list()).find((g) => g.id === id)).toBeUndefined();
  });
  it("groups legacy sources, preserves immutable legacy data, and permits reimport after discard", async () => {
    const record = { ...sampleRecord("product"), Topic: "Legacy archive regression" };
    const importSource = () =>
      as(owner, () =>
        scalar<number>(
          "select public.import_knowledge_records_v2($1,$2,'Legacy source.xlsx',$3::jsonb,$4::jsonb) value",
          [
            org,
            randomUUID(),
            JSON.stringify([record]),
            JSON.stringify({ worksheet: "Sample Data", rows: [2] }),
          ],
        ),
      );
    expect(await importSource()).toBe(1);
    const group = (await list()).find((g) => g.sourceName === "Legacy source.xlsx")!;
    expect(group.kind).toBe("legacy");
    expect(await discard(group)).toBe(1);
    expect(
      await scalar<number>(
        "select count(*)::int value from public.knowledge_source_records where batch_id=$1",
        [group.id],
      ),
    ).toBe(1);
    expect(await importSource()).toBe(1);
  });
});
