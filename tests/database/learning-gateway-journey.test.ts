import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// Session transport is synthetic. Actions, parsing, migrations, RLS and saved data are real local implementations.
vi.mock("@/lib/session", () => import("../import-harness/database"));
import { db, initialize, withIdentity } from "../import-harness/database";
import { GET as downloadTemplate } from "@/app/app/knowledge/templates/route";
import { columns, sampleRecord } from "@/lib/knowledge/templates";
import {
  approveGatewayKnowledge,
  commitGatewayUpload,
  saveGatewayReview,
  uploadGatewaySource,
} from "@/app/app/knowledge/gateway-actions";
import { createCourse } from "@/app/app/actions";
import { addApprovedKnowledge } from "@/app/app/learning/knowledge-actions";
import {
  publishLearningRevision,
  recordLearningProgress,
} from "@/app/app/learning/progress-actions";
import { loadLearningPath } from "@/lib/knowledge/learning";
import { loadLearningWorkspace } from "@/lib/learning/read-model";
import { readWorkspaceProgress } from "@/lib/workspace-data";
import { resumeUnitIndex, sourceCheckpoint } from "@/lib/learning/curriculum";
import { loadDraftManager } from "@/lib/knowledge/draft-manager";
import { discardDraftGroup } from "@/app/app/knowledge/draft-actions";

beforeAll(initialize);
afterAll(() => db.close());

describe("official template to member learning: actual actions and SQL, synthetic verified sessions", () => {
  it("downloads, populates, parses, reviews, saves, approves, publishes, records and reopens without tenant leakage", async () => {
    const titles = ["Fictional confirmed source alpha", "Fictional confirmed source beta"];
    const courseId = await withIdentity("owner-a", async () => {
      const response = await downloadTemplate(
        new Request(
          "http://localhost/app/knowledge/templates?id=product&format=xlsx&variant=blank",
        ),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toContain(
        "saleschild-product-blank.xlsx",
      );
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await response.arrayBuffer());
      const sample = workbook.getWorksheet("Sample Data")!;
      expect(workbook.getWorksheet("Instructions")).toBeTruthy();
      for (const title of titles) {
        const record = sampleRecord("product");
        record.Topic = title;
        sample.addRow(columns.map((column) => record[column]));
      }
      const form = new FormData();
      form.set(
        "file",
        new File([new Uint8Array(await workbook.xlsx.writeBuffer())], "fictional-learning.xlsx", {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const staged = await uploadGatewaySource(form);
      expect(staged.error).toBeUndefined();
      if (!staged.upload) throw Error("Actual template upload did not return a review");
      const upload = staged.upload;
      const choices = {
        ...upload.choices,
        sheet: upload.extraction.sheets.findIndex((sheet) => sheet.name === "Sample Data"),
        headerRow: 1,
        edits: {},
        labels: [],
        titleColumn: "",
      };
      const review = await saveGatewayReview({ id: upload.id, revision: upload.revision, choices });
      expect(review.error).toBeUndefined();
      const saved = await commitGatewayUpload({
        id: upload.id,
        revision: review.revision,
        requestId: crypto.randomUUID(),
      });
      expect(saved.error).toBeUndefined();
      expect(saved.savedIds).toHaveLength(2);
      for (const id of saved.savedIds!) {
        const approved = await approveGatewayKnowledge({ id, version: 1 });
        expect(approved.error).toBeUndefined();
      }
      const pathForm = new FormData();
      pathForm.set("title", "Fictional published integration path");
      pathForm.set(
        "description",
        "Approved fictional sources used for the complete local learning journey.",
      );
      const created = await createCourse({}, pathForm);
      expect(created.error).toBeUndefined();
      const course = (
        await db.query<{ id: string }>("select id from public.courses where title=$1", [
          "Fictional published integration path",
        ])
      ).rows[0];
      const added = await addApprovedKnowledge({
        courseId: course.id,
        sourceIds: saved.savedIds,
        requestId: crypto.randomUUID(),
      });
      expect(added).toMatchObject({ added: 2 });
      const path = await loadLearningPath(course.id);
      expect(path?.lessons).toHaveLength(2);
      const published = await publishLearningRevision({
        courseId: course.id,
        lessonIds: path!.lessons.map((lesson) => lesson.id),
      });
      expect(published.error).toBeUndefined();
      const ownerPreview = await loadLearningWorkspace(course.id);
      expect(ownerPreview.units).toHaveLength(2);
      expect(ownerPreview.progress).toEqual([]);
      const attempts = await recordLearningProgress({
        courseId: course.id,
        revisionId: ownerPreview.revision!.id,
        unitId: ownerPreview.units[0].id,
        action: "complete",
        step: 1,
        evidence: titles[0],
      });
      expect(attempts.error).toContain("previews do not record");
      const progress = await readWorkspaceProgress();
      expect(progress.error).toBeUndefined();
      expect(progress.rows.find((row) => row.course_id === course.id)).toMatchObject({
        total_units: 2,
        completed_units: 0,
        started_at: null,
      });
      const groups = await loadDraftManager();
      const protectedGroup = groups.groups.find((group) =>
        group.records.some((record) => saved.savedIds!.includes(record.id)),
      )!;
      expect(protectedGroup.publishedCount).toBe(2);
      const denied = await discardDraftGroup({
        id: protectedGroup.id,
        kind: protectedGroup.kind,
        confirmed: true,
        records: protectedGroup.records.map(({ id, version }) => ({ id, version })),
      });
      expect(denied.error).toContain("approved knowledge or learning dependencies");
      return course.id;
    });
    await withIdentity("learner-b", async () => {
      expect(await loadLearningPath(courseId)).toBeNull();
      expect((await loadLearningWorkspace(courseId)).revision).toBeNull();
    });
    await withIdentity("learner-a", async () => {
      const untouched = await loadLearningWorkspace(courseId);
      expect(untouched.progress).toEqual([]);
      const unit = untouched.units[0],
        second = untouched.units[1],
        revisionId = untouched.revision!.id;
      const input = { courseId, revisionId, unitId: unit.id, step: 1 };
      const started = await recordLearningProgress({ ...input, action: "start" });
      expect(started.progress).toMatchObject({ completed_at: null, checkpoint_passed: false });
      const incorrect = await recordLearningProgress({
        ...input,
        action: "complete",
        evidence: "Unsupported invented response",
      });
      expect(incorrect.error).toContain("Review the approved source");
      const completed = await recordLearningProgress({
        ...input,
        action: "complete",
        evidence: sourceCheckpoint(unit).expected,
      });
      expect(completed.saved).toBe(true);
      expect(completed.progress?.checkpoint_passed).toBe(true);
      expect(completed.progress?.completed_at).toBeTruthy();
      const replay = await recordLearningProgress({
        ...input,
        action: "complete",
        evidence: sourceCheckpoint(unit).expected,
      });
      expect(replay.progress?.completed_at).toBe(completed.progress?.completed_at);
      expect(
        (await recordLearningProgress({ ...input, unitId: second.id, action: "resume" })).saved,
      ).toBe(true);
      const reopened = await loadLearningWorkspace(courseId);
      expect(
        resumeUnitIndex(
          reopened.units.map((item) => item.id),
          reopened.progress,
        ),
      ).toBe(1);
      expect(reopened.progress.find((item) => item.unit_id === second.id)).toMatchObject({
        resume_step: 1,
        completed_at: null,
        checkpoint_passed: false,
      });
      const progress = await readWorkspaceProgress();
      expect(progress.error).toBeUndefined();
      expect(progress.rows.find((row) => row.course_id === courseId)).toMatchObject({
        total_units: 2,
        completed_units: 1,
      });
      expect((await loadLearningPath(courseId))?.lessons.map((item) => item.title)).toEqual(titles);
    });
  });
  it("discards a saved upload through the actual confirmed action and tolerates a replay without deleting history", async () => {
    await withIdentity("owner-a", async () => {
      const form = new FormData();
      form.set(
        "file",
        new File(
          [
            "Procedure,Documented detail\r\nFictional draft for safe discard,This fictional draft is deliberately kept separate from approved learning content.\r\n",
          ],
          "fictional-discard.csv",
          { type: "text/csv" },
        ),
      );
      const staged = await uploadGatewaySource(form);
      expect(staged.error).toBeUndefined();
      const upload = staged.upload!;
      const reviewed = await saveGatewayReview({
        id: upload.id,
        revision: upload.revision,
        choices: upload.choices,
      });
      expect(reviewed.error).toBeUndefined();
      const saved = await commitGatewayUpload({
        id: upload.id,
        revision: reviewed.revision,
        requestId: crypto.randomUUID(),
      });
      expect(saved.error).toBeUndefined();
      const groups = await loadDraftManager();
      const group = groups.groups.find((item) => item.id === upload.id)!;
      expect(group.draftCount).toBe(1);
      const request = {
        id: group.id,
        kind: group.kind,
        records: group.records.map(({ id, version }) => ({ id, version })),
      };
      expect((await discardDraftGroup(request)).error).toContain("Confirm");
      const discarded = await discardDraftGroup({ ...request, confirmed: true });
      expect(discarded.error).toBeUndefined();
      expect(discarded.groups.find((item) => item.id === group.id)).toMatchObject({
        draftCount: 0,
        discardedCount: 1,
      });
      const replay = await discardDraftGroup({ ...request, confirmed: true });
      expect(replay.error).toBeUndefined();
      expect(replay.groups.find((item) => item.id === group.id)).toMatchObject({
        draftCount: 0,
        discardedCount: 1,
      });
      expect(
        (
          await db.query("select id from public.gateway_sources where knowledge_id=$1", [
            saved.savedIds![0],
          ])
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await db.query("select id from public.knowledge_versions where knowledge_id=$1", [
            saved.savedIds![0],
          ])
        ).rows.length,
      ).toBeGreaterThan(0);
    });
  });
});
