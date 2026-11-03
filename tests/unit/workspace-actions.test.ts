import { beforeEach, describe, it, expect, vi } from "vitest";
const { workspace, revalidate } = vi.hoisted(() => ({ workspace: vi.fn(), revalidate: vi.fn() }));
vi.mock("../../src/lib/session", () => ({ requireWorkspace: workspace }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
import { updateKnowledge, createKnowledge } from "../../src/app/app/actions";
const org = "10000000-0000-4000-8000-000000000001";
const id = "20000000-0000-4000-8000-000000000001";
let filters: Array<[string, unknown]>;
let outcome: { data: { id: string } | null; error: null };
let from: ReturnType<typeof vi.fn>;
function form() {
  const data = new FormData();
  for (const [k, v] of Object.entries({
    id,
    version: "2",
    title: "Updated draft title",
    body: "A useful revised knowledge record with enough content.",
    source_url: "",
    status: "draft",
  }))
    data.set(k, v);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  filters = [];
  outcome = { data: { id }, error: null };
  const chain = {
    eq: (k: string, v: unknown) => {
      filters.push([k, v]);
      return chain;
    },
    select: () => chain,
    maybeSingle: async () => outcome,
  };
  from = vi.fn(() => ({
    update: vi.fn(() => chain),
    insert: vi.fn(async () => ({ error: null })),
  }));
  workspace.mockResolvedValue({
    role: "editor",
    organization: { id: org },
    user: { id },
    client: { from },
  });
});
describe("draft edit action boundaries", () => {
  it("requires author permission before contacting the data API", async () => {
    workspace.mockResolvedValue({ role: "learner" });
    expect((await updateKnowledge({}, form())).error).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });
  it("scopes updates to current organization, draft and expected version", async () => {
    expect((await updateKnowledge({}, form())).success).toBe(true);
    expect(filters).toEqual([
      ["id", id],
      ["organization_id", org],
      ["status", "draft"],
      ["current_version", 2],
    ]);
    expect(revalidate).toHaveBeenCalledWith("/app/knowledge");
  });
  it("does not report success for stale or inaccessible rows", async () => {
    outcome = { data: null, error: null };
    expect((await updateKnowledge({}, form())).error).toBe(true);
    expect(revalidate).not.toHaveBeenCalled();
  });
  it("rejects tampered record identifiers", async () => {
    const data = form();
    data.set("id", "not-an-id");
    expect((await updateKnowledge({}, data)).error).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });
  it("refreshes the actual knowledge route after creation", async () => {
    expect((await createKnowledge({}, form())).success).toBe(true);
    expect(revalidate).toHaveBeenCalledWith("/app/knowledge");
  });
});
