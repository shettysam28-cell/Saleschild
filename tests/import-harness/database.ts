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
  for (const [i, name] of ["owner-a", "owner-b", "learner-a"].entries()) {
    const user = `00000000-0000-4000-8000-00000000000${i + 1}`;
    await db.query("insert into auth.users values($1,now())", [user]);
    identities[name] = { user, org: "", role: i === 2 ? "learner" : "owner" };
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
  identities["learner-a"].org = identities["owner-a"].org;
  await db.query("insert into public.memberships(organization_id,user_id,role)values($1,$2,$3)", [
    identities["learner-a"].org,
    identities["learner-a"].user,
    "learner",
  ]);
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
export async function requireWorkspace() {
  const identity = identities[context.getStore() ?? ""];
  if (!identity) throw Error("Fixture authentication required");
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      await db.exec("savepoint rpc");
      try {
        if (!["check_knowledge_import", "import_knowledge_records_v2"].includes(name))
          throw Error("Unexpected RPC");
        const keys =
          name === "check_knowledge_import"
            ? ["org_id", "records"]
            : ["org_id", "request_id", "source_name", "records", "source_context"];
        const result = await db.query<{ result: unknown }>(
          `select public.${name}(${keys.map((_, i) => "$" + (i + 1)).join(",")})result`,
          keys.map((k) => (typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k])),
        );
        await db.exec("release savepoint rpc");
        return { data: result.rows[0].result, error: null };
      } catch (e) {
        await db.exec("rollback to savepoint rpc");
        return { data: null, error: { code: (e as { code?: string }).code } };
      }
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let changes: Record<string, unknown> | undefined;
      const chain = {
        select: () => chain,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return chain;
        },
        order: () => chain,
        update: (v: Record<string, unknown>) => {
          changes = v;
          return chain;
        },
        maybeSingle: async () => {
          if (table !== "knowledge_items" || !changes) throw Error("Unexpected fixture mutation");
          try {
            const result = await db.query(
              "update public.knowledge_items set title=$1,body=$2,source_url=$3,status=$4 where id=$5 and organization_id=$6 and status=$7 and current_version=$8 returning id",
              [
                changes.title,
                changes.body,
                changes.source_url,
                changes.status,
                filters.id,
                filters.organization_id,
                filters.status,
                filters.current_version,
              ],
            );
            return { data: result.rows[0] ?? null, error: null };
          } catch {
            throw Error("Fixture mutation failed");
          }
        },
        limit: async () => {
          if (table !== "knowledge_source_records") throw Error("Unexpected fixture query");
          const result = await db.query(
            `select s.knowledge_id,s.fields,json_build_object('title',k.title,'body',k.body,'current_version',k.current_version,'status',k.status) knowledge_items from public.knowledge_source_records s join public.knowledge_items k on k.id=s.knowledge_id and k.organization_id=s.organization_id where s.organization_id=$1 and k.status='published' order by s.created_at limit 201`,
            [filters.organization_id],
          );
          return { data: result.rows, error: null };
        },
      };
      return chain;
    },
  };
  return {
    client,
    user: { id: identity.user },
    organization: { id: identity.org },
    role: identity.role,
  };
}
export async function records() {
  return (
    await db.query(
      "select id,title,body,source_url,status,current_version from public.knowledge_items order by created_at",
    )
  ).rows;
}
