import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  db,
  initialize,
  withIdentity,
  identities,
  requireWorkspace,
} from "../import-harness/database";
import { columns } from "@/lib/knowledge/templates";
import { readFieldLabels } from "@/lib/knowledge/field-label-reader";
import type { SupabaseClient } from "@supabase/supabase-js";
let source: string, upload: string, draft: string;
const fields = columns.map((_, i) => ({
  id: `c${i + 1}`,
  label: `Column ${i + 1}`,
  value: `Fictional documented value ${i + 1}`,
}));
beforeAll(async () => {
  await initialize();
  await withIdentity("owner-a", async () => {
    const who = identities["owner-a"];
    const extraction = {
      format: "csv",
      name: "fictional.csv",
      warnings: [],
      sheets: [
        {
          name: "Sample",
          rows: [
            { row: 1, cells: columns },
            { row: 2, cells: fields.map((f) => f.value) },
          ],
        },
      ],
    };
    upload = (
      await db.query<{ id: string }>(
        "insert into public.gateway_uploads(organization_id,created_by,source_name,source_digest,format,extraction,choices)values($1,$2,'fictional.csv',repeat('a',64),'csv',$3::jsonb,$4::jsonb)returning id",
        [
          who.org,
          who.user,
          JSON.stringify(extraction),
          JSON.stringify({ sheet: 0, headerRow: 0, labels: [], edits: {}, titleColumn: "" }),
        ],
      )
    ).rows[0].id;
    for (const status of ["published", "draft"]) {
      const f = fields.map((x) => ({ ...x, value: x.value + status }));
      const id = (
        await db.query<{ id: string }>(
          "insert into public.knowledge_items(organization_id,title,body,custom_fields,status,created_by)values($1,$2,private.gateway_body($3::jsonb),$3::jsonb,$4,$5)returning id",
          [who.org, `Fictional ${status} source`, JSON.stringify(f), status, who.user],
        )
      ).rows[0].id;
      await db.query(
        "insert into public.gateway_sources(organization_id,knowledge_id,upload_id,origin,original_fields)values($1,$2,$3,$4::jsonb,$5::jsonb)",
        [
          who.org,
          id,
          upload,
          JSON.stringify({ worksheet: "Sample", row: 2, headerRow: 0 }),
          JSON.stringify(f),
        ],
      );
      if (status === "published") source = id;
      else draft = id;
    }
  });
});
afterAll(() => db.close());
const labels = () =>
  db.query<{ knowledge_id: string; labels: Record<string, string> }>(
    "select * from public.read_knowledge_field_labels($1,$2::uuid[])",
    [identities["owner-a"].org, [source, draft]],
  );
describe("minimal authorized source-label lookup in actual SQL", () => {
  it("recognizes the entire known template header and preserves source rows", async () => {
    await withIdentity("owner-a", async () => {
      const before = (
        await db.query("select custom_fields from public.knowledge_items where id=$1", [source])
      ).rows;
      const rows = (await labels()).rows;
      expect(rows).toHaveLength(2);
      expect(rows[0].labels).toMatchObject({
        c1: "Topic",
        c5: "Knowledge Content",
        c17: "Content Owner",
      });
      const { client } = await requireWorkspace();
      expect(
        (
          await readFieldLabels(client as unknown as SupabaseClient, identities["owner-a"].org, [
            source,
          ])
        )[source],
      ).toMatchObject({ c1: "Topic", c5: "Knowledge Content" });
      expect(
        (await db.query("select custom_fields from public.knowledge_items where id=$1", [source]))
          .rows,
      ).toEqual(before);
    });
  });
  it("returns members only approved-source labels, without upload content or draft access", async () => {
    await withIdentity("learner-a", async () => {
      const rows = (await labels()).rows;
      expect(rows.map((r) => r.knowledge_id)).toEqual([source]);
      expect(Object.keys(rows[0]).sort()).toEqual(["knowledge_id", "labels"]);
      expect(Object.values(rows[0].labels)).not.toContain(fields[0].value);
      expect((await db.query("select id from public.gateway_uploads")).rows).toEqual([]);
    });
  });
  it("denies other tenants, anonymous calls and oversized lookups", async () => {
    await expect(withIdentity("owner-b", labels)).rejects.toThrow(/Organization access/);
    await withIdentity("owner-b", async () =>
      expect(
        (
          await db.query("select * from public.read_knowledge_field_labels($1,$2::uuid[])", [
            identities["owner-b"].org,
            [source],
          ])
        ).rows,
      ).toEqual([]),
    );
    await withIdentity(
      "owner-a",
      async () =>
        await expect(
          db.query("select * from public.read_knowledge_field_labels($1,$2::uuid[])", [
            identities["owner-a"].org,
            Array(201).fill(source),
          ]),
        ).rejects.toThrow(/at most 200/),
    );
    await db.exec("begin;set local role anon");
    try {
      await expect(labels()).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("rollback");
    }
  });
  it("prefers stored mapping and does not infer template labels from column count alone", async () => {
    await db.query(
      "update public.gateway_uploads set choices=jsonb_set(choices,'{labels}','[\"Company topic\"]'::jsonb) where id=$1",
      [upload],
    );
    await withIdentity("owner-a", async () =>
      expect((await labels()).rows[0].labels.c1).toBe("Company topic"),
    );
    await db.query(
      "update public.gateway_uploads set choices=jsonb_set(choices,'{labels}','[]'::jsonb),extraction=jsonb_set(extraction,'{sheets,0,rows,0,cells}',$1::jsonb) where id=$2",
      [JSON.stringify(columns.map((_, i) => `Arbitrary field ${i + 1}`)), upload],
    );
    await withIdentity("owner-a", async () => expect((await labels()).rows[0].labels).toEqual({}));
  });
});
