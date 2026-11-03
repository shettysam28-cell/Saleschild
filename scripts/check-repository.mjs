import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
async function git(args) {
  try {
    return (await execute("git", args, { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 })).stdout;
  } catch {
    throw new Error("Git inspection failed; no response contents logged.");
  }
}
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const patterns = [
  /\bgh[pousr]_[a-zA-Z0-9]{20,}\b/,
  /\bgithub_pat_[a-zA-Z0-9_]{20,}\b/,
  /\bre_[a-zA-Z0-9]{20,}\b/,
  /\bsb_secret_[a-zA-Z0-9_-]{20,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
function check(data, label) {
  if (data.includes(0)) return;
  const text = data.toString("utf8");
  assert(
    !text.includes(["PRIVATE DEVELOPMENT MATERIAL.", " This file"].join("")) &&
      !text.includes(["Consolidated Internal", " Development Skills"].join("")),
    `Private instructions in ${label}`,
  );
  assert(
    !patterns.some((p) => p.test(text)),
    `Credential-like material in ${label}; remove and review privately.`,
  );
}
const files = new Set(
  (await git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]))
    .toString()
    .split("\0")
    .filter(Boolean),
);
for (const file of files) {
  assert(!/^docs\/internal\//.test(file), "Private documentation selected for public commit");
  assert(
    !/^(?:node_modules|\.next|\.netlify|test-results|playwright-report)\//.test(file),
    `Generated/runtime files must not be committed: ${file}`,
  );
  assert(
    !/^\.env/.test(file) || file === ".env.example",
    `Environment file must not be committed: ${file}`,
  );
  try {
    check(readFileSync(file), file);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
const history = (await git(["rev-list", "--objects", "--all"])).toString();
let blobs = 0;
for (const line of history.split("\n").filter(Boolean)) {
  const hash = line.split(" ")[0];
  const type = (await git(["cat-file", "-t", hash])).toString().trim();
  if (type !== "blob") continue;
  check(await git(["cat-file", "blob", hash]), `historical blob ${hash}`);
  blobs++;
}
console.log(
  `Repository checks passed: ${files.size} current files, ${blobs} historical blobs; no credential-pattern hits or generated runtime files selected for commit.`,
);
