import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => import("../import-harness/database"));
import { db, initialize, withIdentity, identities } from "../import-harness/database";
import { fetchKnowledge } from "@/app/app/fetch-actions";
import { createRevisionGuide } from "@/app/app/learning/revision-actions";
import { loadStudyGuide } from "@/lib/learning/guides";
import { loadDraftManager } from "@/lib/knowledge/draft-manager";
let sourceId: string, courseId: string, revisionId: string;
const fields = [
  {
    id: "c1",
    label: "Company guidance",
    value: "Fictional workspace guidance: reserve the sample desk before training.",
  },
];
beforeAll(async () => {
  await initialize();
  await withIdentity("owner-a", async () => {
    const user = identities["owner-a"];
    for (const [title, body] of [
      [
        "Insurance training",
        "Fictional insurance workflow: ask the sample support lead for approved policy wording.",
      ],
      ["Workspace guide", fields[0].value],
      [
        "Refund procedure",
        "Fictional refund procedure: submit a reimbursement request and keep the sample receipt.",
      ],
      [
        "GST training",
        "Fictional GST workflow: send the sample invoice to the training finance lead. No tax rate is specified.",
      ],
    ]) {
      const result = await db.query<{ id: string }>(
        "insert into public.knowledge_items(organization_id,title,body,status,created_by,custom_fields)values($1,$2,case when jsonb_array_length($5::jsonb)>0 then private.gateway_body($5::jsonb) else $3 end,'published',$4,$5::jsonb)returning id",
        [
          user.org,
          title,
          body,
          user.user,
          JSON.stringify(title === "Workspace guide" ? fields : []),
        ],
      );
      if (title === "Workspace guide") sourceId = result.rows[0].id;
    }
    courseId = (
      await db.query<{ id: string }>(
        "insert into public.courses(organization_id,title,description,created_by)values($1,'Fictional lesson pathway','Documented sample workspace training for tests.',$2)returning id",
        [user.org, user.user],
      )
    ).rows[0].id;
    await db.query("select public.add_knowledge_to_learning_path($1,$2,$3::uuid[],$4)", [
      user.org,
      courseId,
      "{" + sourceId + "}",
      crypto.randomUUID(),
    ]);
    const ids = (
      await db.query<{ id: string }>(
        "select id from public.lessons where course_id=$1 order by position",
        [courseId],
      )
    ).rows.map((x) => x.id);
    revisionId = (
      await db.query<{ id: string }>(
        "select public.publish_learning_revision($1,$2,$3::uuid[])id",
        [user.org, courseId, "{" + ids.join(",") + "}"],
      )
    ).rows[0].id;
  });
  await withIdentity("owner-b", () =>
    db.query(
      "insert into public.knowledge_items(organization_id,title,body,status,created_by)values($1,'Foreign insurance secret','Fictional insurance detail belonging only to the other tenant.','published',$2)",
      [identities["owner-b"].org, identities["owner-b"].user],
    ),
  );
});
afterAll(() => db.close());
describe("real SQL/RLS correction journeys with synthetic verified identities", () => {
  it.each([
    "insurance",
    "workspace",
    "refund",
    "GST",
    "How do I request a refund?",
    "How should our workspace be prepared?",
  ])("answers %s using approved authorized evidence", async (query) => {
    await withIdentity("learner-a", async () => {
      const a = await fetchKnowledge(query);
      expect(a.error).toBeUndefined();
      expect(a.answer?.summary).not.toBeNull();
      expect(a.answer?.citations.length).toBeGreaterThan(0);
      expect(JSON.stringify(a)).not.toContain("Foreign insurance secret");
      expect(JSON.stringify(a.answer)).not.toContain("18%");
    });
  });
  it("does not return tenant A knowledge to tenant B or invent unmatched facts", async () => {
    await withIdentity("learner-b", async () => {
      const a = await fetchKnowledge("workspace");
      expect(a.answer?.summary).toBeNull();
      expect(a.answer?.citations).toEqual([]);
    });
    await withIdentity("learner-a", async () =>
      expect((await fetchKnowledge("uniquenonexistentconcept")).answer?.summary).toBeNull(),
    );
  });
  it("creates a retrievable revision artifact without creating progress and reuses it on retry", async () => {
    await withIdentity("owner-a", async () => {
      const before = (await loadStudyGuide(courseId))!;
      expect(before.savedAt).toBeUndefined();
      const created = await createRevisionGuide({ courseId, revisionId });
      expect(created.error).toBeUndefined();
      expect(created.url).toContain("edition=" + revisionId);
      const first = (await loadStudyGuide(courseId, revisionId))!;
      expect(first.savedAt).toBeTruthy();
      expect(first.units[0].source_knowledge_id).toBe(sourceId);
      expect(first.units[0].source_fields).toEqual(fields);
      await createRevisionGuide({ courseId, revisionId });
      expect((await loadStudyGuide(courseId, revisionId))?.savedAt).toBe(first.savedAt);
      expect((await db.query("select * from public.learning_unit_progress")).rows).toHaveLength(0);
    });
  });
  it("isolates member guide references and denies forged cross-organization guide IDs", async () => {
    await withIdentity("learner-a", async () => {
      expect((await loadStudyGuide(courseId, revisionId))?.savedAt).toBeUndefined();
      expect((await createRevisionGuide({ courseId, revisionId })).error).toBeUndefined();
      expect((await loadStudyGuide(courseId, revisionId))?.savedAt).toBeTruthy();
      expect((await db.query("select * from public.learning_unit_progress")).rows).toHaveLength(0);
    });
    await withIdentity("learner-b", async () => {
      expect(await loadStudyGuide(courseId, revisionId)).toBeNull();
      expect((await createRevisionGuide({ courseId, revisionId })).error).toBeTruthy();
    });
  });
  it("keeps saved guide content on the immutable edition after source editing", async () => {
    await withIdentity("owner-a", async () => {
      await db.query(
        "update public.knowledge_items set body='A later fictional draft must not replace the approved edition.',status='draft',custom_fields='[]'::jsonb where id=$1",
        [sourceId],
      );
      const saved = (await loadStudyGuide(courseId, revisionId))!;
      expect(saved.units[0].body).toContain(fields[0].value);
      const before = await fetchKnowledge("workspace");
      expect(before.answer?.summary).toBeNull();
    });
  });
  it("reports real grouped draft eligibility without granting member management access", async () => {
    await withIdentity("owner-a", async () =>
      expect((await loadDraftManager()).error).toBeUndefined(),
    );
    await withIdentity("learner-a", async () =>
      expect((await loadDraftManager()).error).toContain("Author"),
    );
  });
  it("keeps anonymous guide APIs and lifecycle mutation blocked", async () => {
    await db.exec("begin;set local role anon");
    try {
      await expect(
        db.query("select public.save_learning_guide($1,$2)", [
          identities["owner-a"].org,
          revisionId,
        ]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("rollback");
    }
    await withIdentity(
      "learner-a",
      async () =>
        await expect(
          db.query("update public.learning_revision_guides set created_at=now()"),
        ).rejects.toThrow(/permission denied/),
    );
  });
});
