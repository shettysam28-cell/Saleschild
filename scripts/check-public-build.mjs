import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
const terms = [
  "Consolidated Internal Development Skills",
  "PRIVATE DEVELOPMENT MATERIAL",
  "AGENTS.md",
  "SALESCHILD_SKILLS.md",
  "private-contact@gmail.com",
];
async function walk(dir) {
  try {
    return (
      await Promise.all(
        (await readdir(dir, { withFileTypes: true })).map((e) =>
          e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
        ),
      )
    ).flat();
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
const files = [
  ...(await walk(".next/static")),
  ...(await walk("public")),
  ...(await walk(".next/server/app")).filter((p) => /\.(html|rsc)$/.test(p)),
];
assert(files.length > 0, "Build first; there are no generated public artifacts.");
for (const file of files) {
  assert(!/\.map$/.test(file), `Public source map: ${file}`);
  const data = await readFile(file, "utf8");
  for (const term of terms) assert(!data.includes(term), `Internal content exposed in ${file}`);
  assert(
    !/\b(?:re_[a-zA-Z0-9]{20,}|sb_secret_[a-zA-Z0-9_-]+)\b/.test(data),
    `Secret-like value in ${file}`,
  );
}
for (const file of await walk(".next/server")) {
  if (!file.endsWith(".nft.json")) continue;
  const manifest = JSON.parse(await readFile(file, "utf8"));
  assert(
    !(manifest.files ?? []).some((p) => /AGENTS\.md|SALESCHILD_SKILLS\.md|docs\/internal/.test(p)),
    `Private material in server trace ${file}`,
  );
}
console.log(
  `Public build checks passed: ${files.length} artifacts, no internal content or browser source maps.`,
);
