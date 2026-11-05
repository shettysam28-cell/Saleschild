import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { workspace, rpc, revalidate } = vi.hoisted(() => ({
  workspace: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireWorkspace: workspace }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
import {
  beginLearningRevision,
  publishLearningRevision,
  recordLearningProgress,
} from "@/app/app/learning/progress-actions";
import { loadLearningWorkspace } from "@/lib/learning/read-model";

const org = "10000000-0000-4000-8000-000000000001",
  courseId = "20000000-0000-4000-8000-000000000001",
  revisionId = "30000000-0000-4000-8000-000000000001",
  unitId = "40000000-0000-4000-8000-000000000001";
const evidence = "Inspect the approved fictional training indicator.";
const input = { courseId, revisionId, unitId, action: "complete", step: 1, evidence };
const saved = {
  unit_id: unitId,
  started_at: "2026-11-04T10:00:00Z",
  completed_at: "2026-11-04T10:04:00Z",
  checkpoint_passed: true,
  resume_step: 1,
  updated_at: "2026-11-04T10:04:00Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  workspace.mockResolvedValue({ role: "learner", organization: { id: org }, client: { rpc } });
  rpc.mockResolvedValue({ data: saved, error: null });
});

describe("learning actions keep database authorization authoritative", () => {
  it.each(["owner", "admin", "editor"])("%s previews cannot create progress", async (role) => {
    workspace.mockResolvedValue({ role });
    expect((await recordLearningProgress(input)).error).toMatch(/previews/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("passes exact evidence and session organization to SQL and returns the saved row", async () => {
    const result = await recordLearningProgress(input);
    expect(rpc).toHaveBeenCalledWith("record_learning_progress", {
      org_id: org,
      revision_id: revisionId,
      unit_id: unitId,
      action: "complete",
      step: 1,
      evidence,
    });
    expect(result.progress).toEqual(saved);
    expect(revalidate).toHaveBeenCalledWith(`/app/learning/${courseId}`);
  });
  it("does not accept client correctness, user identity, organization or completion flags", async () => {
    for (const extra of [
      { correct: true },
      { userId: unitId },
      { org_id: org },
      { checkpoint_passed: true },
    ])
      expect((await recordLearningProgress({ ...input, ...extra })).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("start and resume never send inferred completion evidence", async () => {
    await recordLearningProgress({ courseId, revisionId, unitId, action: "resume", step: 1 });
    expect(rpc.mock.calls[0][1]).toMatchObject({ action: "resume", evidence: null });
  });
  it("reports failed checkpoints without exposing provider internals or claiming progress", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "private schema diagnostic" },
    });
    const result = await recordLearningProgress(input);
    expect(result.error).toMatch(/exact documented value/);
    expect(JSON.stringify(result)).not.toContain("private schema");
    expect(result.saved).toBeUndefined();
    expect(revalidate).not.toHaveBeenCalled();
  });
  it("does not claim a successful checkpoint for missing, foreign-unit or incomplete saved data", async () => {
    for (const data of [
      null,
      { ...saved, unit_id: revisionId },
      { ...saved, completed_at: null, checkpoint_passed: false },
    ]) {
      rpc.mockResolvedValue({ data, error: null });
      expect((await recordLearningProgress(input)).error).toMatch(/could not be confirmed/);
    }
    expect(revalidate).not.toHaveBeenCalled();
  });
  it("fails closed for missing migrations, stale versions and denied membership", async () => {
    for (const code of ["PGRST202", "40001", "42501"]) {
      rpc.mockResolvedValue({ data: null, error: { code } });
      expect((await recordLearningProgress(input)).error).toBeTruthy();
    }
    expect(revalidate).not.toHaveBeenCalled();
  });
  it("rejects invalid units, oversized evidence and unsupported steps before database access", async () => {
    for (const change of [
      { unitId: "invalid" },
      { evidence: "x".repeat(8001) },
      { step: 3 },
      { action: "mark_all_complete" },
    ])
      expect((await recordLearningProgress({ ...input, ...change })).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("only administrators publish or prepare source compositions", async () => {
    expect((await publishLearningRevision({ courseId, lessonIds: [unitId] })).error).toMatch(
      /owner or administrator/,
    );
    expect((await beginLearningRevision({ courseId })).error).toMatch(/owner or administrator/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("preserves reviewed lesson order and relies on SQL for publication checks", async () => {
    workspace.mockResolvedValue({ role: "owner", organization: { id: org }, client: { rpc } });
    rpc.mockResolvedValue({ data: revisionId, error: null });
    const next = "40000000-0000-4000-8000-000000000002";
    expect(
      (await publishLearningRevision({ courseId, lessonIds: [next, unitId] })).revisionId,
    ).toBe(revisionId);
    expect(rpc).toHaveBeenCalledWith("publish_learning_revision", {
      org_id: org,
      course_id: courseId,
      expected_lesson_ids: [next, unitId],
    });
  });
  it("rejects duplicate lesson identities and client-selected organizations", async () => {
    workspace.mockResolvedValue({ role: "owner", organization: { id: org }, client: { rpc } });
    expect(
      (await publishLearningRevision({ courseId, lessonIds: [unitId, unitId] })).error,
    ).toBeTruthy();
    expect(
      (await publishLearningRevision({ courseId, lessonIds: [unitId], org_id: org })).error,
    ).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("prepares the next composition without passing or overwriting any member progress", async () => {
    workspace.mockResolvedValue({ role: "admin", organization: { id: org }, client: { rpc } });
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await beginLearningRevision({ courseId })).toEqual({ prepared: true });
    expect(rpc).toHaveBeenCalledWith("begin_learning_revision", {
      org_id: org,
      course_id: courseId,
    });
  });
  it("does not claim a published or reopened revision without a confirmed database result", async () => {
    workspace.mockResolvedValue({ role: "owner", organization: { id: org }, client: { rpc } });
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await publishLearningRevision({ courseId, lessonIds: [unitId] })).error).toMatch(
      /could not be confirmed/,
    );
    expect((await beginLearningRevision({ courseId })).error).toMatch(/could not be confirmed/);
    expect(revalidate).not.toHaveBeenCalled();
  });
});

describe("learning revision read models", () => {
  it("loads only the trusted organization's revision and own progress", async () => {
    const revision = {
      id: revisionId,
      course_id: courseId,
      number: 1,
      title: "Fictional source learning",
      published_at: "2026-11-04T10:00:00Z",
    };
    rpc.mockResolvedValue({ data: { revision, units: [], progress: [saved] }, error: null });
    expect(await loadLearningWorkspace(courseId)).toMatchObject({
      revision,
      progress: [saved],
      author: false,
      canPublish: false,
      available: true,
    });
    expect(rpc).toHaveBeenCalledWith("read_learning_revision", {
      org_id: org,
      course_id: courseId,
    });
  });
  it("never supplies learner progress to owner preview components", async () => {
    workspace.mockResolvedValue({ role: "owner", organization: { id: org }, client: { rpc } });
    rpc.mockResolvedValue({ data: { revision: null, progress: [saved] }, error: null });
    expect(await loadLearningWorkspace(courseId)).toMatchObject({
      progress: [],
      author: true,
      canPublish: true,
    });
  });
  it("allows an honest unavailable state before the reviewed migration is applied", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    expect(await loadLearningWorkspace(courseId)).toMatchObject({
      available: false,
      revision: null,
      units: [],
      progress: [],
    });
  });
  it("does not disguise authorization or service failures as successful empty learning", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private diagnostic" } });
    await expect(loadLearningWorkspace(courseId)).rejects.toThrow("could not be loaded");
  });
});
