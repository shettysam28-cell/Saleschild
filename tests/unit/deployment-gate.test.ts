import { describe, it, expect, vi } from "vitest";
import { awaitGithubCI } from "../../scripts/await-github-ci.mjs";
import { developmentDeployment } from "../../scripts/development-deployment.mjs";
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

const developmentEnv = {
  ...env,
  SITE_ID: developmentDeployment.siteId,
  BRANCH: developmentDeployment.branch,
  APP_URL: developmentDeployment.origins.production,
  NEXT_PUBLIC_SUPABASE_URL: developmentDeployment.supabaseUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fictional_fixture",
  MEMBER_PROVISIONING_ENABLED: "false",
  MEMBER_VERIFICATION_EMAIL_ENABLED: "false",
  RESEND_SENDING_ENABLED: "false",
  CONTACT_FORM_ENABLED: "false",
};
describe("isolated development publication retains exact-commit CI", () => {
  const developmentRun = { ...run, head_branch: developmentDeployment.branch };
  it("accepts the approved branch only on the development site after its push CI passes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([developmentRun]));
    expect(await awaitGithubCI({ env: developmentEnv, fetcher })).toContain(
      "exact development commit",
    );
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("branch")).toBe(developmentDeployment.branch);
    expect(url.searchParams.get("event")).toBe("push");
    expect(url.searchParams.get("head_sha")).toBe(sha);
  });
  it.each([undefined, "1d26223b-029f-41aa-ab43-0aed4f2c45e3", "unapproved-site"])(
    "cannot enable the feature-branch production-context path on site %s",
    async (siteId) => {
      const fetcher = vi.fn();
      await expect(
        awaitGithubCI({
          env: { ...developmentEnv, SITE_ID: siteId, SALESCHILD_DEVELOPMENT: "true" },
          fetcher,
        }),
      ).rejects.toThrow("Production deployment requires the main branch");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each(["main", "feature/unapproved"])("rejects development branch %s", async (branch) => {
    await expect(
      awaitGithubCI({ env: { ...developmentEnv, BRANCH: branch }, fetcher: vi.fn() }),
    ).rejects.toThrow("approved Phase 2.2 branch");
  });
  it("rejects mismatched project coordinates or enabled provisioning before querying CI", async () => {
    for (const changes of [
      { NEXT_PUBLIC_SUPABASE_URL: "https://pmthueylomurnypbpezn.supabase.co" },
      { MEMBER_PROVISIONING_ENABLED: "true" },
      { MEMBER_VERIFICATION_EMAIL_ENABLED: "true" },
    ]) {
      const fetcher = vi.fn();
      await expect(
        awaitGithubCI({ env: { ...developmentEnv, ...changes }, fetcher }),
      ).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    }
  });
  it("does not accept a main, PR, foreign-repository or different-commit run", async () => {
    for (const other of [
      run,
      { ...developmentRun, event: "pull_request" },
      { ...developmentRun, repository: { full_name: "another/project" } },
      { ...developmentRun, head_sha: "b".repeat(40) },
    ])
      await expect(
        awaitGithubCI({
          env: developmentEnv,
          fetcher: async () => response([other]),
          attempts: 1,
        }),
      ).rejects.toThrow(/Timed out/);
  });
  it("holds development deployment when the matching CI failed", async () => {
    await expect(
      awaitGithubCI({
        env: developmentEnv,
        fetcher: async () => response([{ ...developmentRun, conclusion: "failure" }]),
      }),
    ).rejects.toThrow("did not succeed for this development commit");
  });
});
