import { beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { workspace, rpc, revalidate } = vi.hoisted(() => ({
  workspace: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireWorkspace: workspace }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
import {
  inspectKnowledgeUpload,
  validateKnowledgeUpload,
  previewAcademy,
} from "@/app/app/knowledge/import-actions";
import { GET } from "@/app/app/knowledge/templates/route";
import { createTemplate } from "@/lib/knowledge/spreadsheets";
import { columns, sampleRecord, sampleRecords } from "@/lib/knowledge/templates";
const org = "10000000-0000-4000-8000-000000000001";
async function source() {
  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array(await createTemplate("general", "csv", true))], "general.csv"),
  );
  form.set("mapping", JSON.stringify(Object.fromEntries(columns.map((c) => [c, c]))));
  form.set("requestId", "20000000-0000-4000-8000-000000000001");
  return form;
}
beforeEach(() => {
  vi.clearAllMocks();
  workspace.mockResolvedValue({ role: "editor", organization: { id: org }, client: { rpc } });
  rpc.mockResolvedValue({ data: [], error: null });
});
describe("server-owned import authorization and error recovery", () => {
  it("denies learner uploads, validation, downloads and academy previews before data access", async () => {
    workspace.mockResolvedValue({ role: "learner" });
    const form = await source();
    expect((await inspectKnowledgeUpload(form)).error).toMatch(/authors/);
    expect((await validateKnowledgeUpload(form)).error).toMatch(/authors/);
    expect((await previewAcademy()).error).toMatch(/administrator/);
    expect(
      (
        await GET(
          new Request(
            "https://saleschild.example/app/knowledge/templates?id=general&format=csv&variant=sample",
          ),
        )
      ).status,
    ).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("derives the organization from the session, never the supplied form", async () => {
    const form = await source();
    form.set("organization_id", "foreign-organization");
    expect((await validateKnowledgeUpload(form)).readiness?.ready).toBe(true);
    expect(rpc.mock.calls[0][1].org_id).toBe(org);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("reparses the source on approval and ignores forged readiness or records", async () => {
    const form = await source();
    form.set("approve", "yes");
    form.set("readiness", JSON.stringify({ ready: true }));
    form.set("records", "[]");
    rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: 2, error: null });
    expect((await validateKnowledgeUpload(form)).imported).toBe(2);
    expect(rpc.mock.calls[1][1].records).toEqual(sampleRecords("general"));
    expect(revalidate).toHaveBeenCalledWith("/app/knowledge");
  });
  it("does not import invalid mappings or duplicate records despite approval", async () => {
    const form = await source();
    form.set("approve", "yes");
    rpc.mockResolvedValue({
      data: [{ fields: sampleRecord("general"), knowledge_id: "existing" }],
      error: null,
    });
    expect((await validateKnowledgeUpload(form)).error).toMatch(/Resolve/);
    expect(rpc).toHaveBeenCalledTimes(1);
    form.set("mapping", JSON.stringify({ Topic: "Topic", Category: "Topic" }));
    expect((await validateKnowledgeUpload(form)).error).toBeDefined();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("fails closed on database errors without exposing database internals", async () => {
    const form = await source();
    form.set("approve", "yes");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "private database diagnostic" } });
    const failed = await validateKnowledgeUpload(form);
    expect(failed.error).toMatch(/No records/);
    expect(JSON.stringify(failed)).not.toContain("private database diagnostic");
    rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "private database diagnostic" } });
    expect((await validateKnowledgeUpload(form)).error).toMatch(/Nothing was imported/);
    expect(revalidate).not.toHaveBeenCalled();
  });
  it("delivers only known authenticated templates with private cache policy", async () => {
    const result = await GET(
      new Request(
        "https://saleschild.example/app/knowledge/templates?id=general&format=xlsx&variant=blank",
      ),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(result.headers.get("content-disposition")).toContain("attachment");
    expect(
      (
        await GET(
          new Request(
            "https://saleschild.example/app/knowledge/templates?id=unknown&format=csv&variant=sample",
          ),
        )
      ).status,
    ).toBe(400);
  });
  it("requires administrator access to academy proposals and omits changed source snapshots", async () => {
    const data = [
      {
        knowledge_id: "one",
        fields: sampleRecord("general"),
        knowledge_items: {
          title: sampleRecord("general").Topic,
          body: sampleRecord("general")["Knowledge Content"],
          status: "published",
          current_version: 2,
        },
      },
      {
        knowledge_id: "two",
        fields: sampleRecord("product"),
        knowledge_items: {
          title: "Edited source",
          body: "Changed",
          status: "published",
          current_version: 3,
        },
      },
    ];
    const filters: unknown[] = [];
    const chain = {
      select: () => chain,
      eq: (...args: unknown[]) => {
        filters.push(args);
        return chain;
      },
      order: () => chain,
      limit: async () => ({ data, error: null }),
    };
    workspace.mockResolvedValue({
      role: "admin",
      organization: { id: org },
      client: { from: () => chain },
    });
    const result = await previewAcademy();
    expect(filters).toContainEqual(["organization_id", org]);
    expect(filters).toContainEqual(["knowledge_items.status", "published"]);
    expect(result.omitted).toBe(1);
    expect(result.readiness).toMatchObject({
      total: 1,
      categories: [sampleRecord("general").Category],
      missingSources: 0,
      assessments: 1,
      ready: true,
    });
    expect(result.curriculum?.[0].lessons[0]).toMatchObject({ id: "one", version: 2 });
  });
});
