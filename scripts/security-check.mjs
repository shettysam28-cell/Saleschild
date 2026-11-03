import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
const root = process.cwd();
const internalTerms = ["SALESCHILD_SKILLS.md", "AGENTS.md", "private-contact@gmail.com"];
async function files(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])),
      )
    ).flat();
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
const clientFiles = [
  ...(await files(join(root, "src/components"))),
  ...(await files(join(root, "public"))),
];
for (const path of clientFiles) {
  const text = await readFile(path, "utf8");
  for (const term of internalTerms)
    assert(!text.includes(term), `Internal content in customer asset: ${path}`);
}
for (const path of await files(join(root, "src"))) {
  if (!/\.[jt]sx?$/.test(path)) continue;
  const text = await readFile(path, "utf8");
  assert(
    !/NEXT_PUBLIC_\w*(?:SECRET|TOKEN|SERVICE_ROLE|RESEND|PASSWORD)/.test(text),
    `Privileged public environment variable in ${path}`,
  );
  assert(
    !/\b(?:re_[a-zA-Z0-9]{20,}|sb_secret_[a-zA-Z0-9_-]+)\b/.test(text),
    `Credential-like value in ${path}`,
  );
  assert(!/from\s+["'](?:node:)?fs/.test(text), `Unexpected runtime filesystem access in ${path}`);
}
const pkg = JSON.parse(await readFile("package.json", "utf8"));
assert.equal(pkg.private, true, "npm package must be private");
for (const section of ["dependencies", "devDependencies"]) {
  for (const [name, version] of Object.entries(pkg[section]))
    assert(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version), `Pin ${name} exactly`);
}
assert((await readFile(".gitignore", "utf8")).includes(".env*"));
assert((await readFile(".gitignore", "utf8")).includes(".netlify/"));
assert((await readFile("next.config.ts", "utf8")).includes("productionBrowserSourceMaps: false"));
console.log(
  `Security source checks passed (${clientFiles.length} customer assets; exact dependencies; secret boundaries).`,
);
