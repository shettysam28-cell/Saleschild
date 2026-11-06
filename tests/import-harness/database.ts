import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
export const db = new PGlite();
export const identities: Record<string, { user: string; org: string; role: string }> = {};
const context = new AsyncLocalStorage<string>();
let queue = Promise.resolve();
export async function initialize() {
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated,anon;`,
  );
  for (const name of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
  for (const [i, name] of ["owner-a", "owner-b", "learner-a", "editor-a", "learner-b"].entries()) {
    const user = `00000000-0000-4000-8000-00000000000${i + 1}`;
    await db.query("insert into auth.users values($1,now())", [user]);
    identities[name] = { user, org: "", role: i === 3 ? "editor" : i >= 2 ? "learner" : "owner" };
    if (i < 2) {
      await db.exec("begin;set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      identities[name].org = (
        await db.query<{ id: string }>("select public.create_organization($1)id", [
          "Import fixture " + name,
        ])
      ).rows[0].id;
      await db.exec("commit");
    }
  }
  for (const name of ["learner-a", "editor-a", "learner-b"]) {
    identities[name].org = identities[name === "learner-b" ? "owner-b" : "owner-a"].org;
    await db.query("insert into public.memberships(organization_id,user_id,role)values($1,$2,$3)", [
      identities[name].org,
      identities[name].user,
      identities[name].role,
    ]);
  }
}
export async function withIdentity<T>(name: string, work: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = queue;
  queue = new Promise<void>((r) => (release = r));
  await previous;
  try {
    await db.exec("begin;set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [identities[name].user]);
    const result = await context.run(name, work);
    await db.exec("commit");
    return result;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  } finally {
    release();
  }
}
const rpcKeys: Record<string, string[]> = {
  check_knowledge_import: ["org_id", "records"],
  import_knowledge_records_v2: ["org_id", "request_id", "source_name", "records", "source_context"],
  stage_gateway_upload: [
    "org_id",
    "source_name",
    "source_digest",
    "source_format",
    "extraction",
    "choices",
  ],
  check_gateway_duplicates: ["org_id", "candidates"],
  save_gateway_review: ["org_id", "upload_id", "expected_revision", "choices", "rows"],
  commit_gateway_upload: ["org_id", "upload_id", "expected_revision", "request_id"],
  update_gateway_knowledge: ["org_id", "knowledge_id", "expected_version", "title", "fields"],
  add_knowledge_to_learning_path: ["org_id", "course_id", "source_ids", "request_id"],
  read_learning_path: ["org_id", "course_id"],
  publish_learning_revision: ["org_id", "course_id", "expected_lesson_ids"],
  begin_learning_revision: ["org_id", "course_id"],
  read_learning_revision: ["org_id", "course_id"],
  record_learning_progress: ["org_id", "revision_id", "unit_id", "action", "step", "evidence"],
  read_learning_progress: ["org_id", "member_id", "course_id", "from_date", "to_date"],
  search_approved_knowledge: ["org_id", "query_text", "result_limit"],
  list_workspace_members: ["org_id"],
  list_knowledge_draft_groups: ["org_id"],
  list_knowledge_draft_groups_v2: ["org_id"],
  list_individual_knowledge_drafts: ["org_id"],
  save_learning_guide: ["org_id", "revision_id"],
  discard_knowledge_draft_group: ["org_id", "group_id", "group_kind", "expected_records"],
};
const tables = new Set([
  "knowledge_items",
  "knowledge_source_records",
  "knowledge_versions",
  "gateway_uploads",
  "gateway_sources",
  "courses",
  "lessons",
  "learning_path_revisions",
  "learning_revision_units",
  "learning_unit_progress",
  "learning_revision_guides",
]);
const quoted = (name: string) => {
  if (!/^[a-z_]+$/.test(name)) throw Error("Unsafe fixture identifier");
  return '"' + name + '"';
};
const bound = (value: unknown) =>
  value !== null && typeof value === "object" ? JSON.stringify(value) : value;
async function query(sql: string, args: unknown[] = []) {
  await db.exec("savepoint fixture_query");
  try {
    const result = await db.query<Record<string, unknown>>(sql, args);
    await db.exec("release savepoint fixture_query");
    // Match the Data API's JSON transport (not PGlite's native Date objects).
    const rows = JSON.parse(JSON.stringify(result.rows)) as Record<string, unknown>[];
    return { data: rows, error: null };
  } catch (e) {
    await db.exec("rollback to savepoint fixture_query");
    return { data: null, error: { code: (e as { code?: string }).code } };
  }
}
function from(table: string) {
  if (!tables.has(table)) throw Error("Unexpected fixture table");
  const filters: { key: string; value: unknown; op: string }[] = [];
  let operation = "select",
    changes: Record<string, unknown> = {},
    selection = "*",
    ordering = "",
    maximum: number | undefined;
  function execute() {
    if (selection.includes("!inner"))
      return query(
        "select s.knowledge_id,s.fields,json_build_object('title',k.title,'body',k.body,'current_version',k.current_version,'status',k.status) knowledge_items from public.knowledge_source_records s join public.knowledge_items k on k.id=s.knowledge_id and k.organization_id=s.organization_id where s.organization_id=$1 and k.status='published' order by s.created_at limit 201",
        [filters.find((f) => f.key === "organization_id")?.value],
      );
    const values: unknown[] = [];
    const conditions = filters.map((f) =>
      f.op === "is" && f.value === null
        ? quoted(f.key) + " is null"
        : (values.push(bound(f.value)), quoted(f.key) + f.op + "$" + values.length),
    );
    const where = conditions.length ? " where " + conditions.join(" and ") : "";
    const columns = selection === "*" ? "*" : selection.split(",").map(quoted).join(",");
    if (operation === "insert") {
      const keys = Object.keys(changes);
      return query(
        `insert into public.${quoted(table)}(${keys.map(quoted).join(",")})values(${keys.map((_, i) => "$" + (i + 1)).join(",")}) returning ${columns}`,
        keys.map((k) => bound(changes[k])),
      );
    }
    if (operation === "update") {
      const assignments = Object.keys(changes).map((k) => {
        values.push(bound(changes[k]));
        return quoted(k) + "=$" + values.length;
      });
      return query(
        `update public.${quoted(table)} set ${assignments.join(",")}${where} returning ${columns}`,
        values,
      );
    }
    if (operation === "delete")
      return query(`delete from public.${quoted(table)}${where} returning id`, values);
    return query(
      `select ${columns} from public.${quoted(table)}${where}${ordering}${maximum === undefined ? "" : " limit " + maximum}`,
      values,
    );
  }
  const chain = {
    select: (value = "*") => {
      selection = value;
      return chain;
    },
    eq: (key: string, value: unknown) => {
      filters.push({ key, value, op: "=" });
      return chain;
    },
    gt: (key: string, value: unknown) => {
      filters.push({ key, value, op: ">" });
      return chain;
    },
    is: (key: string, value: unknown) => {
      filters.push({ key, value, op: "is" });
      return chain;
    },
    order: (key: string, options: { ascending?: boolean } = {}) => {
      ordering = " order by " + quoted(key) + (options.ascending === false ? " desc" : " asc");
      return chain;
    },
    limit: (n: number) => {
      if (!Number.isInteger(n) || n < 0 || n > 1000) throw Error("Fixture limit");
      maximum = n;
      return chain;
    },
    insert: (data: Record<string, unknown>) => {
      operation = "insert";
      changes = data;
      return chain;
    },
    update: (data: Record<string, unknown>) => {
      operation = "update";
      changes = data;
      return chain;
    },
    delete: () => {
      operation = "delete";
      return chain;
    },
    maybeSingle: async () => {
      const result = await execute();
      return { ...result, data: result.data?.[0] ?? null };
    },
    single: async () => {
      const result = await execute();
      return {
        ...result,
        data: result.data?.[0] ?? null,
        error: result.error ?? (result.data?.length === 1 ? null : { code: "PGRST116" }),
      };
    },
    then: (
      resolve: (v: Awaited<ReturnType<typeof execute>>) => unknown,
      reject?: (e: unknown) => unknown,
    ) => execute().then(resolve, reject),
  };
  return chain;
}
export async function requireWorkspace() {
  const identity = identities[context.getStore() ?? ""];
  if (!identity) throw Error("Fixture authentication required");
  const client = {
    from,
    rpc: async (name: string, args: Record<string, unknown>) => {
      const keys = rpcKeys[name];
      if (!keys) throw Error("Unexpected fixture RPC");
      const rows = ["read_learning_progress", "search_approved_knowledge"].includes(name);
      const call = `public.${name}(${keys.map((_, i) => "$" + (i + 1)).join(",")})`;
      const result = await query(
        rows ? `select * from ${call}` : `select ${call} result`,
        keys.map((k) =>
          ["source_ids", "expected_lesson_ids"].includes(k) ? args[k] : bound(args[k]),
        ),
      );
      return { ...result, data: rows ? result.data : (result.data?.[0]?.result ?? null) };
    },
  };
  return {
    client,
    user: { id: identity.user, email: "fictional-member@example.test" },
    profile: { displayName: identity.role === "learner" ? "Fictional Member" : "Fictional Owner" },
    organization: { id: identity.org, name: "Fictional organization" },
    role: identity.role,
  };
}
export async function requireUser() {
  const { client, user } = await requireWorkspace();
  return { client, user };
}
export async function records() {
  return (
    await db.query(
      "select id,title,body,source_url,status,current_version,custom_fields from public.knowledge_items where discarded_at is null order by created_at",
    )
  ).rows;
}
export async function paths() {
  return (
    await db.query("select id,title,description,status from public.courses order by created_at")
  ).rows;
}
export async function fixtureRole() {
  return identities[context.getStore() ?? ""]?.role;
}
