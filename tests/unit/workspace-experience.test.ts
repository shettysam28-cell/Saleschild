import { describe, it, expect, vi, beforeEach } from "vitest";
import { runInNewContext } from "node:vm";
import { navigationModules } from "../../src/lib/modules";
import {
  summarizeProgress,
  parseAnalyticsFilters,
  type ProgressRow,
} from "../../src/lib/workspace-progress";
import { resolveAppearance, workspaceAppearanceScript } from "../../src/lib/workspace-appearance";

const { workspace, rpc } = vi.hoisted(() => ({ workspace: vi.fn(), rpc: vi.fn() }));
vi.mock("../../src/lib/session", () => ({ requireWorkspace: workspace }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { fetchKnowledge } from "../../src/app/app/fetch-actions";
import { requestWorkflow, updateOrganization } from "../../src/app/app/actions";
import { readLearningPathCards, readWorkspaceProgress } from "../../src/lib/workspace-data";
const org = "10000000-0000-4000-8000-000000000001";
const user = "20000000-0000-4000-8000-000000000001";
const course = "30000000-0000-4000-8000-000000000001";
const revision = "40000000-0000-4000-8000-000000000001";
const row: ProgressRow = {
  user_id: user,
  course_id: course,
  revision_id: revision,
  path_title: "Safety guide",
  revision_number: 1,
  total_units: 1,
  completed_units: 1,
  started_at: "2026-11-04T12:00:00Z",
  last_activity_at: "2026-11-04T12:01:00Z",
  completed_at: "2026-11-04T12:01:00Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  workspace.mockResolvedValue({ client: { rpc }, organization: { id: org }, role: "owner" });
});

describe("role-aware workspace and truthful progress", () => {
  it("keeps member navigation separate from author and organization administration", () => {
    expect(navigationModules("learner").map((module) => module.slug)).toEqual([
      "learning",
      "assessments",
      "workflows",
      "progression",
    ]);
    expect(navigationModules("learner")[0].title).toBe("Learning Pathway");
    expect(navigationModules("owner").map((module) => module.slug)).toEqual([
      "knowledge",
      "learning",
      "assessments",
      "workflows",
      "analytics",
    ]);
    for (const role of ["admin", "editor"] as const)
      expect(navigationModules(role).some((module) => module.slug === "analytics")).toBe(false);
  });
  it("weights completion by eligible units rather than averaging paths", () => {
    const summary = summarizeProgress([
      row,
      {
        ...row,
        course_id: org,
        total_units: 9,
        completed_units: 0,
        started_at: null,
        completed_at: null,
      },
    ]);
    expect(summary).toEqual({
      eligible: 10,
      completed: 1,
      remaining: 9,
      percent: 10,
      startedPaths: 1,
      completedPaths: 1,
    });
    expect(summarizeProgress([]).percent).toBe(0);
  });
  it("does not count viewing or zero-unit paths as completed", () => {
    expect(
      summarizeProgress([{ ...row, completed_units: 0, completed_at: null, started_at: null }])
        .completedPaths,
    ).toBe(0);
    expect(summarizeProgress([{ ...row, total_units: 0, completed_units: 0 }]).completedPaths).toBe(
      0,
    );
  });
  it("filters path starts and completion dates independently of period unit counts", () => {
    const period = { from: "2026-11-04", to: "2026-11-04" };
    expect(
      summarizeProgress(
        [{ ...row, started_at: "2026-11-03T12:00:00Z", total_units: 10, completed_units: 1 }],
        period,
      ),
    ).toMatchObject({ completed: 1, startedPaths: 0, completedPaths: 1 });
    expect(summarizeProgress([row], { from: "2026-11-05" })).toMatchObject({
      startedPaths: 0,
      completedPaths: 0,
    });
  });
  it("does not round unfinished learning up to one hundred percent", () => {
    expect(summarizeProgress([{ ...row, total_units: 2000, completed_units: 1999 }]).percent).toBe(
      99.9,
    );
  });
  it("rejects malformed or inverted analytics filters", () => {
    expect(parseAnalyticsFilters({ member: "forged" })).toHaveProperty("error");
    expect(parseAnalyticsFilters({ from: "2026-12-01", to: "2026-11-01" })).toHaveProperty("error");
    expect(parseAnalyticsFilters({ from: "2026-13-12" })).toHaveProperty("error");
    expect(parseAnalyticsFilters({ member: [user, course] })).toHaveProperty("error");
    expect(parseAnalyticsFilters({ member: user, path: course, from: "2026-11-01" })).toEqual({
      member: user,
      path: course,
      from: "2026-11-01",
      to: "",
    });
  });
  it("loads member path cards from published revisions, never mutable composition metadata", async () => {
    const from = vi.fn();
    workspace.mockResolvedValue({
      client: { rpc, from },
      organization: { id: org },
      role: "learner",
    });
    rpc.mockResolvedValue({ data: [row], error: null });
    expect(await readLearningPathCards()).toEqual({
      records: [
        {
          id: course,
          title: "Safety guide",
          description: "1 documented learning unit · 1 completed.",
          status: "Published · version 1",
        },
      ],
      error: undefined,
    });
    expect(from).not.toHaveBeenCalled();
  });
  it("does not turn unavailable progression into a verified zero result", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    expect(await readWorkspaceProgress()).toMatchObject({
      rows: [],
      error: expect.stringContaining("migration"),
    });
    rpc.mockResolvedValue({ data: [{ ...row, completed_at: "invalid" }], error: null });
    expect(await readWorkspaceProgress()).toMatchObject({
      rows: [],
      error: expect.stringContaining("could not be verified"),
    });
  });
  it("disables unfinished workflow writes even through a direct server action", async () => {
    const from = vi.fn();
    workspace.mockResolvedValue({ client: { from }, role: "owner" });
    expect((await requestWorkflow({}, new FormData())).error).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });
  it("does not let a legacy administrator edit the organization", async () => {
    const from = vi.fn();
    workspace.mockResolvedValue({ client: { from }, role: "admin" });
    expect((await updateOrganization({}, new FormData())).error).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("approved source Fetch", () => {
  it("passes a bounded query and trusted organization to the search RPC", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: course,
          title: "Escalation",
          body: "Use the approved escalation process.",
          current_version: 2,
        },
      ],
      error: null,
    });
    const result = await fetchKnowledge("  escalation  ");
    expect(rpc).toHaveBeenCalledWith("search_approved_knowledge", {
      org_id: org,
      query_text: "escalation",
      result_limit: 5,
    });
    expect(result.results).toEqual([
      {
        id: course,
        title: "Escalation",
        excerpt: "Use the approved escalation process.",
        version: 2,
      },
    ]);
  });
  it("does not fabricate a response when there is no approved match", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await fetchKnowledge("unknown process")).toMatchObject({
      results: [],
      message: expect.stringContaining("No matching approved"),
    });
  });
  it("fails closed on unavailable migration, invalid query or invalid data", async () => {
    expect((await fetchKnowledge("x")).error).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    expect(await fetchKnowledge("process")).toMatchObject({
      error: true,
      message: expect.stringContaining("migration"),
    });
    rpc.mockResolvedValue({ data: [{ id: "bad", title: "Invalid" }], error: null });
    expect((await fetchKnowledge("process")).results).toBeUndefined();
  });
  it("bounds displayed excerpts and keeps uploaded markup as plain text", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: course,
          title: "<script>untrusted</script>",
          body: "<img onerror=alert(1)>" + "x".repeat(1000),
          current_version: 1,
        },
      ],
      error: null,
    });
    const result = await fetchKnowledge("untrusted");
    expect(result.results?.[0].excerpt).toHaveLength(601);
    expect(result.results?.[0].title).toBe("<script>untrusted</script>");
  });
});

describe("workspace appearance", () => {
  it("respects explicit light/dark and system preference", () => {
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
  });
  it("initializes before paint with an explicit local choice and no network", () => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(workspaceAppearanceScript, {
      document,
      localStorage: { getItem: () => "light" },
      matchMedia: () => ({ matches: true }),
    });
    expect(document.documentElement.dataset.workspaceTheme).toBe("light");
  });
  it("uses the system safely when local storage is blocked", () => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(workspaceAppearanceScript, {
      document,
      localStorage: {
        getItem: () => {
          throw Error("blocked");
        },
      },
      matchMedia: () => ({ matches: true }),
    });
    expect(document.documentElement.dataset.workspaceTheme).toBe("dark");
  });
});
