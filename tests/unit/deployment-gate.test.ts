import { describe, it, expect, vi } from "vitest";
import { awaitGithubCI } from "../../scripts/await-github-ci.mjs";
const sha = "a".repeat(40);
const env = {
  NODE_ENV: "test" as const,
  NETLIFY: "true",
  CONTEXT: "production",
  BRANCH: "main",
  COMMIT_REF: sha,
};
const run = {
  head_sha: sha,
  head_branch: "main",
  event: "push",
  repository: { full_name: "shettysam28-cell/Saleschild" },
  status: "completed",
  conclusion: "success",
};
const response = (runs: unknown[]) => new Response(JSON.stringify({ workflow_runs: runs }));
describe("production publication waits for the matching main CI", () => {
  it("allows offline validation without making requests", async () => {
    const fetcher = vi.fn();
    expect(await awaitGithubCI({ env: { NODE_ENV: "test" }, fetcher })).toContain("Local build");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("denies missing context, the wrong branch and invalid commit references", async () => {
    for (const invalid of [
      { ...env, CONTEXT: "" },
      { ...env, BRANCH: "feature" },
      { ...env, COMMIT_REF: "main" },
    ])
      await expect(awaitGithubCI({ env: invalid })).rejects.toThrow();
  });
  it("accepts only a successful workflow for the exact main commit", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([run]));
    expect(await awaitGithubCI({ env, fetcher })).toContain("passed");
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("head_sha")).toBe(sha);
    expect(url.searchParams.get("branch")).toBe("main");
  });
  it("does not accept successful checks for another commit, branch, event or repository", async () => {
    for (const other of [
      { ...run, head_sha: "b".repeat(40) },
      { ...run, head_branch: "feature" },
      { ...run, event: "pull_request" },
      { ...run, repository: { full_name: "another/project" } },
    ])
      await expect(
        awaitGithubCI({ env, fetcher: async () => response([other]), attempts: 1 }),
      ).rejects.toThrow(/Timed out/);
  });
  it("holds publication on failure, cancellation or an unavailable API", async () => {
    for (const conclusion of ["failure", "cancelled", "timed_out"])
      await expect(
        awaitGithubCI({ env, fetcher: async () => response([{ ...run, conclusion }]) }),
      ).rejects.toThrow(/did not succeed/);
    await expect(
      awaitGithubCI({ env, fetcher: async () => new Response("", { status: 403 }) }),
    ).rejects.toThrow(/HTTP 403/);
    await expect(awaitGithubCI({ env, fetcher: async () => new Response("{}") })).rejects.toThrow(
      /invalid CI result/,
    );
  });
  it("waits for queued CI and then permits the matching successful result", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response([{ ...run, status: "in_progress", conclusion: null }]))
      .mockResolvedValueOnce(response([run]));
    const pause = vi.fn(async () => {});
    expect(await awaitGithubCI({ env, fetcher, pause, attempts: 2 })).toContain("passed");
    expect(pause).toHaveBeenCalledTimes(1);
  });
});
