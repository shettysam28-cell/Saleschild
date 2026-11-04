import { beforeEach, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { workspace, extract, rpc, revalidate, from, results, filters } = vi.hoisted(() => ({
  workspace: vi.fn(),
  extract: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
  from: vi.fn(),
  results: [] as { data: unknown; error: unknown }[],
  filters: [] as unknown[][],
}));
vi.mock("@/lib/session", () => ({ requireWorkspace: workspace }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
vi.mock("@/lib/knowledge/gateway-extraction", () => ({ extractGateway: extract }));
import {
  uploadGatewaySource,
  loadGatewayUpload,
  saveGatewayReview,
  commitGatewayUpload,
  approveGatewayKnowledge,
  updateGatewayKnowledge,
} from "@/app/app/knowledge/gateway-actions";
import { addApprovedKnowledge } from "@/app/app/learning/knowledge-actions";
import {
  defaultChoices,
  type GatewayExtraction,
  type GatewayUpload,
} from "@/lib/knowledge/gateway-model";
const org = "10000000-0000-4000-8000-000000000001",
  user = "10000000-0000-4000-8000-000000000002",
  id = "20000000-0000-4000-8000-000000000001",
  saved = "20000000-0000-4000-8000-000000000002",
  requestId = "30000000-0000-4000-8000-000000000001";
const extraction: GatewayExtraction = {
  name: "company.csv",
  format: "csv",
  warnings: [],
  sheets: [
    {
      name: "CSV",
      rows: [
        { row: 1, cells: ["Procedure", "Local instruction"] },
        {
          row: 2,
          cells: [
            "Fictional setup",
            "Inspect the fictional training indicator before starting the simulation.",
          ],
        },
      ],
    },
  ],
};
let upload: GatewayUpload;
function source() {
  const f = new FormData();
  f.set(
    "file",
    new File(
      [
        "Procedure,Local instruction\nFictional setup,A sufficiently detailed fictional source record.",
      ],
      "company.csv",
    ),
  );
  f.set("organization_id", "foreign-organization");
  return f;
}
beforeEach(() => {
  vi.clearAllMocks();
  results.length = 0;
  filters.length = 0;
  upload = {
    id,
    source_name: "company.csv",
    extraction,
    choices: defaultChoices(extraction),
    revision: 0,
    expires_at: "2099-01-01T00:00:00Z",
    saved_ids: null,
  };
  extract.mockResolvedValue(extraction);
  from.mockImplementation(() => {
    const chain = {
      select: () => chain,
      eq: (...args: unknown[]) => {
        filters.push(args);
        return chain;
      },
      is: () => chain,
      gt: () => chain,
      order: () => chain,
      limit: () => chain,
      update: () => chain,
      delete: () => chain,
      maybeSingle: async () => results.shift() ?? { data: upload, error: null },
    };
    return chain;
  });
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === "stage_gateway_upload"
        ? id
        : name === "save_gateway_review"
          ? 1
          : name === "commit_gateway_upload"
            ? [saved]
            : [],
    error: null,
  }));
  workspace.mockResolvedValue({
    role: "owner",
    organization: { id: org },
    user: { id: user },
    client: { from, rpc },
  });
});
it("denies learners before parsing, database writes and publication", async () => {
  workspace.mockResolvedValue({ role: "learner" });
  expect((await uploadGatewaySource(source())).code).toBe("PERMISSION");
  expect((await saveGatewayReview({})).code).toBe("PERMISSION");
  expect((await commitGatewayUpload({})).code).toBe("PERMISSION");
  expect((await updateGatewayKnowledge({})).code).toBe("PERMISSION");
  expect((await approveGatewayKnowledge({})).code).toBe("PERMISSION");
  expect((await addApprovedKnowledge({})).error).toContain("authors");
  expect(extract).not.toHaveBeenCalled();
  expect(from).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
it("parses once, stages under the trusted organization and scopes cached extraction to its uploader", async () => {
  results.push({ data: null, error: null }, { data: upload, error: null });
  const result = await uploadGatewaySource(source());
  expect(result.upload?.id).toBe(id);
  expect(extract).toHaveBeenCalledOnce();
  const stage = rpc.mock.calls.find(([name]) => name === "stage_gateway_upload")![1];
  expect(stage.org_id).toBe(org);
  expect(stage.source_digest).toMatch(/^[a-f\d]{64}$/);
  expect(filters).toContainEqual(["organization_id", org]);
  expect(filters).toContainEqual(["created_by", user]);
  expect(rpc.mock.calls.some(([name]) => name === "commit_gateway_upload")).toBe(false);
});
it("reuses a matching private extraction without parsing again", async () => {
  results.push({ data: { id }, error: null }, { data: upload, error: null });
  expect((await uploadGatewaySource(source())).upload?.id).toBe(id);
  expect(extract).not.toHaveBeenCalled();
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(["check_gateway_duplicates"]);
});
it("reviews cached source edits without accepting client-provided extracted records", async () => {
  const choices = {
    ...upload.choices,
    edits: {
      "0:2": {
        values: {
          c2: "An owner-corrected fictional instruction with a second approved practice step.",
        },
      },
    },
  };
  const result = await saveGatewayReview({ id, revision: 0, choices });
  expect(result.revision).toBe(1);
  expect(extract).not.toHaveBeenCalled();
  const args = rpc.mock.calls.find(([name]) => name === "save_gateway_review")![1];
  expect(args.org_id).toBe(org);
  expect(args.rows[0].row).toBe(2);
  expect(args.rows[0]).not.toHaveProperty("originalFields");
  expect(args.rows[0].fields[1].value).toContain("owner-corrected");
});
it("rejects edits to rows absent from the selected worksheet", async () => {
  const result = await saveGatewayReview({
    id,
    revision: 0,
    choices: { ...upload.choices, edits: { "0:999": { title: "Forged row" } } },
  });
  expect(result.code).toBe("REVIEW");
  expect(rpc.mock.calls.some(([name]) => name === "save_gateway_review")).toBe(false);
});
it("checks required review choices against the server extraction", async () => {
  expect(
    (await saveGatewayReview({ id, revision: 0, choices: { ...upload.choices, headerRow: 999 } }))
      .code,
  ).toBe("HEADER");
  expect(
    (await saveGatewayReview({ id, revision: 0, choices: { ...upload.choices, sheet: 19 } })).code,
  ).toBe("WORKSHEET");
});
it("commits only the persisted review identity/revision, with no reparsing or uploaded client records", async () => {
  upload.revision = 1;
  const result = await commitGatewayUpload({
    id,
    revision: 1,
    requestId,
    records: [{ title: "forged" }],
    ready: true,
  });
  expect(result.savedIds).toEqual([saved]);
  expect(extract).not.toHaveBeenCalled();
  expect(rpc.mock.calls.find(([name]) => name === "commit_gateway_upload")![1]).toEqual({
    org_id: org,
    upload_id: id,
    expected_revision: 1,
    request_id: requestId,
  });
  expect(revalidate).toHaveBeenCalledWith("/app/knowledge");
});
it("replays saved results without failing duplicate preflight", async () => {
  upload.saved_ids = [saved];
  upload.revision = 1;
  expect((await commitGatewayUpload({ id, revision: 1, requestId })).savedIds).toEqual([saved]);
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(["commit_gateway_upload"]);
});
it("does not expose foreign upload existence or provider diagnostics", async () => {
  results.push({ data: null, error: null });
  expect((await loadGatewayUpload(id)).code).toBe("UPLOAD");
  expect(rpc).not.toHaveBeenCalled();
  results.push({ data: null, error: { code: "42501", message: "private database detail" } });
  const result = await loadGatewayUpload(id);
  expect(result.code).toBe("PERMISSION");
  expect(JSON.stringify(result)).not.toContain("private database");
});
it("expires unsaved reviews while allowing saved recovery", async () => {
  upload.expires_at = "2000-01-01T00:00:00Z";
  expect((await loadGatewayUpload(id)).code).toBe("EXPIRED");
  upload.saved_ids = [saved];
  expect((await loadGatewayUpload(id)).upload?.saved_ids).toEqual([saved]);
});
it("requires administrator approval and rejects unsaved data in approval requests", async () => {
  workspace.mockResolvedValue({ role: "editor" });
  expect((await approveGatewayKnowledge({ id, version: 1 })).code).toBe("PERMISSION");
  workspace.mockResolvedValue({
    role: "owner",
    organization: { id: org },
    user: { id: user },
    client: { from, rpc },
  });
  expect((await approveGatewayKnowledge({ id, version: 1, title: "unsaved edit" })).code).toBe(
    "RECORD",
  );
  expect(from).not.toHaveBeenCalled();
});
it("keeps missing migrations and stale saves actionable without claiming successful writes", async () => {
  rpc.mockImplementation(async (name: string) =>
    name === "commit_gateway_upload"
      ? { data: null, error: { code: "40001" } }
      : { data: [], error: null },
  );
  expect((await commitGatewayUpload({ id, revision: 0, requestId })).code).toBe("STALE_REVIEW");
  results.push({ data: null, error: { code: "42P01" } });
  expect((await loadGatewayUpload(id)).code).toBe("DATABASE_SETUP");
});
