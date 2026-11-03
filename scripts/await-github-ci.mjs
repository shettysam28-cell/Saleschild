import { fileURLToPath } from "node:url";

const repository = "shettysam28-cell/Saleschild";
const workflow = "validate.yml";

export async function awaitGithubCI({
  env = process.env,
  fetcher = fetch,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 61,
  interval = 10000,
} = {}) {
  if (env.NETLIFY !== "true" || env.CONTEXT === "dev")
    return "Local build: production CI gate is not required.";
  if (["deploy-preview", "branch-deploy"].includes(env.CONTEXT))
    return "Non-production build: production CI gate is not required.";
  if (env.CONTEXT !== "production" || env.BRANCH !== "main")
    throw new Error("Production deployment requires the main branch and production context.");
  const sha = env.COMMIT_REF;
  if (!/^[a-f0-9]{40}$/i.test(sha ?? ""))
    throw new Error("Production deployment requires an exact Git commit reference.");
  const endpoint = new URL(
    `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs`,
  );
  endpoint.search = new URLSearchParams({
    branch: "main",
    event: "push",
    head_sha: sha,
    per_page: "10",
  }).toString();
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetcher(endpoint, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new Error(
        `GitHub CI could not be verified (HTTP ${response.status}). Deployment is held.`,
      );
    const result = await response.json();
    if (!Array.isArray(result.workflow_runs))
      throw new Error("GitHub returned an invalid CI result. Deployment is held.");
    const run = result.workflow_runs.find(
      (r) =>
        r.head_sha === sha &&
        r.head_branch === "main" &&
        r.event === "push" &&
        r.repository?.full_name === repository,
    );
    if (run?.status === "completed") {
      if (run.conclusion !== "success")
        throw new Error(
          "GitHub CI did not succeed for this production commit. Deployment is held.",
        );
      return "GitHub CI passed for the exact production commit.";
    }
    if (attempt + 1 < attempts) await pause(interval);
  }
  throw new Error("Timed out waiting for GitHub CI. Deployment is held; retry after CI succeeds.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(await awaitGithubCI());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
